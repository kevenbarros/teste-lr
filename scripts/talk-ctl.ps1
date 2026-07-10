# Interfone ("drop in" caseiro): captura o microfone do PC e reproduz AO VIVO
# nos endpoints WASAPI escolhidos (ex.: Echo/Alexa pareada por Bluetooth), sem
# trocar o dispositivo padrão — mesmo padrão do sound-ctl.ps1. Aceita VÁRIAS
# caixas: -Devices "nome1|nome2" com -Volumes "40|60" (pareados).
# Modos:
#   -Action talk  → transmite o microfone até o processo ser morto (Node child.kill())
#   -Action mics  → imprime os microfones ativos (um por linha, UTF-8) e sai
#   -Action outs  → imprime "ID|FriendlyName" das saídas ativas e sai
#   -Action watch → vigia a saída PADRÃO do Windows; imprime "DEFAULT|ID|nome"
#                   a cada mudança (o Node usa para impedir que o Bluetooth da
#                   Alexa vire a saída padrão e receba o som geral do PC)
# Ao transmitir, imprime "STARTED" (stdout) quando o áudio realmente começa.
# -ParentPid: se o processo pai (Node) morrer, talk/watch saem sozinhos.
# Sai com: 4 = nenhuma caixa disponível, 5 = nenhum microfone, 6 = captação parou.
param(
  [Parameter(Mandatory = $true)][string]$Dll,
  [string]$Devices = '',
  [string]$Volumes = '',
  [string]$Mic = '',
  [int]$LatencyMs = 150,
  [int]$ParentPid = 0,
  [ValidateSet('talk', 'mics', 'outs', 'watch')][string]$Action = 'talk'
)

function Test-ParentAlive([int]$ProcId) {
  if ($ProcId -le 0) { return $true }
  return [bool](Get-Process -Id $ProcId -ErrorAction SilentlyContinue)
}

$ErrorActionPreference = 'Stop'
try {
  Add-Type -Path $Dll
  $enum = New-Object NAudio.CoreAudioApi.MMDeviceEnumerator

  if ($Action -eq 'mics') {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $mics = @($enum.EnumerateAudioEndPoints(
        [NAudio.CoreAudioApi.DataFlow]::Capture,
        [NAudio.CoreAudioApi.DeviceState]::Active))
    ($mics | ForEach-Object { $_.FriendlyName }) -join "`n"
    exit 0
  }

  $all = @($enum.EnumerateAudioEndPoints(
      [NAudio.CoreAudioApi.DataFlow]::Render,
      [NAudio.CoreAudioApi.DeviceState]::Active))

  if ($Action -eq 'outs') {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    ($all | ForEach-Object { "$($_.ID)|$($_.FriendlyName)" }) -join "`n"
    exit 0
  }

  if ($Action -eq 'watch') {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $last = ''
    while (Test-ParentAlive $ParentPid) {
      try {
        $d = $enum.GetDefaultAudioEndpoint(
          [NAudio.CoreAudioApi.DataFlow]::Render,
          [NAudio.CoreAudioApi.Role]::Multimedia)
        $cur = "$($d.ID)|$($d.FriendlyName)"
        if ($cur -ne $last) {
          [Console]::Out.WriteLine("DEFAULT|$cur"); [Console]::Out.Flush()
          $last = $cur
        }
      } catch { }  # sem saída padrão (raro): tenta de novo no próximo ciclo
      Start-Sleep -Milliseconds 2000
    }
    exit 0
  }

  # Resolve cada caixa: nome exato primeiro; senão casa por trecho, excluindo o
  # perfil Headset/Hands-Free do Bluetooth (mesma regra do sound-ctl.ps1).
  $names = @($Devices -split '\|' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $vols = @($Volumes -split '\|')
  $targets = @()
  for ($i = 0; $i -lt $names.Count; $i++) {
    $n = $names[$i]
    $dev = $all | Where-Object { $_.FriendlyName -eq $n } | Select-Object -First 1
    if (-not $dev) {
      $dev = $all |
        Where-Object { $_.FriendlyName -match [regex]::Escape($n) -and $_.FriendlyName -notmatch 'Headset|Hands' } |
        Select-Object -First 1
    }
    if (-not $dev) { continue }  # caixa desconectada: segue com as demais
    $v = 40
    if ($i -lt $vols.Count -and $vols[$i] -match '^\d+$') { $v = [int]$vols[$i] }
    $targets += , @{ Dev = $dev; Vol = [Math]::Max(0, [Math]::Min(100, $v)) }
  }
  if ($targets.Count -eq 0) { exit 4 }

  foreach ($t in $targets) {
    $t.Dev.AudioEndpointVolume.MasterVolumeLevelScalar = $t.Vol / 100
    $t.Dev.AudioEndpointVolume.Mute = $false
  }

  # Microfone: -Mic por nome (exato, depois trecho); vazio = padrão de comunicação.
  $micDev = $null
  if ($Mic) {
    $mics = @($enum.EnumerateAudioEndPoints(
        [NAudio.CoreAudioApi.DataFlow]::Capture,
        [NAudio.CoreAudioApi.DeviceState]::Active))
    $micDev = $mics | Where-Object { $_.FriendlyName -eq $Mic } | Select-Object -First 1
    if (-not $micDev) {
      $micDev = $mics | Where-Object { $_.FriendlyName -match [regex]::Escape($Mic) } | Select-Object -First 1
    }
  } else {
    try {
      $micDev = $enum.GetDefaultAudioEndpoint(
        [NAudio.CoreAudioApi.DataFlow]::Capture,
        [NAudio.CoreAudioApi.Role]::Communications)
    } catch { $micDev = $null }
  }
  if (-not $micDev) { exit 5 }

  # O encanamento mic→caixas fica em C# porque o DataAvailable dispara em thread
  # do NAudio — scriptblock PowerShell não pode ser invocado de lá.
  Add-Type -ReferencedAssemblies $Dll -TypeDefinition @'
using System;
using System.Collections.Generic;
using NAudio.Wave;
using NAudio.CoreAudioApi;

public class MicPipe : IDisposable {
  readonly WasapiCapture capture;
  readonly List<WasapiOut> outs = new List<WasapiOut>();
  readonly List<BufferedWaveProvider> bufs = new List<BufferedWaveProvider>();
  public volatile bool Stopped;

  public MicPipe(MMDevice mic, MMDevice[] speakers, int latencyMs) {
    capture = new WasapiCapture(mic);
    foreach (MMDevice d in speakers) {
      BufferedWaveProvider buf = new BufferedWaveProvider(capture.WaveFormat);
      buf.DiscardOnBufferOverflow = true;  // atraso não acumula se uma caixa engasgar
      buf.BufferDuration = TimeSpan.FromSeconds(2);
      WasapiOut o = new WasapiOut(d, AudioClientShareMode.Shared, false, latencyMs);
      o.Init(buf);
      bufs.Add(buf);
      outs.Add(o);
    }
    capture.DataAvailable += OnData;
    capture.RecordingStopped += delegate { Stopped = true; };
  }

  void OnData(object sender, WaveInEventArgs e) {
    foreach (BufferedWaveProvider b in bufs) b.AddSamples(e.Buffer, 0, e.BytesRecorded);
  }

  public void Start() {
    capture.StartRecording();
    foreach (WasapiOut o in outs) o.Play();
  }

  public void Dispose() {
    try { capture.StopRecording(); } catch { }
    try { capture.Dispose(); } catch { }
    foreach (WasapiOut o in outs) { try { o.Dispose(); } catch { } }
  }
}
'@

  $spk = [NAudio.CoreAudioApi.MMDevice[]]@($targets | ForEach-Object { $_.Dev })
  $pipe = [MicPipe]::new($micDev, $spk, [Math]::Max(50, $LatencyMs))
  try {
    $pipe.Start()
    [Console]::Out.WriteLine('STARTED'); [Console]::Out.Flush()
    while (-not $pipe.Stopped) {
      if (-not (Test-ParentAlive $ParentPid)) { exit 0 }  # Node morreu: não vira órfão com o mic aberto
      Start-Sleep -Milliseconds 250
    }
    exit 6  # captação morreu sozinha (ex.: microfone desconectado)
  } finally {
    $pipe.Dispose()
  }
} catch {
  exit 1
}
