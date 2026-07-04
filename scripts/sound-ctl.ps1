# Controla a reprodução de um som SOMENTE nos dispositivos escolhidos (endpoints
# WASAPI diretos, via NAudio) — sem trocar o dispositivo padrão. Aceita VÁRIAS
# caixas de uma vez: -Devices "nome1|nome2" com -Volumes "40|60" (pareados).
# Modos:
#   -Action play   → toca -Wav em todas as caixas (opcional -Loop, sem emenda)
#                    até o processo ser morto
#   -Action volume → só ajusta o volume dos endpoints e sai
#   -Action list   → imprime os endpoints de saída ativos (um por linha, UTF-8) e sai
# Parar = matar este processo (o Node faz isso via child.kill()).
param(
  [Parameter(Mandatory = $true)][string]$Dll,
  [string]$Devices = 'SoundCore 2',
  [string]$Volumes = '',
  [ValidateSet('play', 'volume', 'list')][string]$Action = 'play',
  [string]$Wav,
  [switch]$Loop
)

$ErrorActionPreference = 'Stop'
try {
  Add-Type -Path $Dll

  $enum = New-Object NAudio.CoreAudioApi.MMDeviceEnumerator
  $all = @($enum.EnumerateAudioEndPoints(
      [NAudio.CoreAudioApi.DataFlow]::Render,
      [NAudio.CoreAudioApi.DeviceState]::Active))

  if ($Action -eq 'list') {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    ($all | ForEach-Object { $_.FriendlyName }) -join "`n"
    exit 0
  }

  # Resolve cada caixa: nome exato primeiro (config aponta um endpoint específico);
  # senão casa por trecho, excluindo o perfil Headset/Hands-Free do Bluetooth (mono,
  # qualidade ruim) — de "SoundCore 2" queremos o A2DP "Fones de ouvido (SoundCore 2)".
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
  if ($targets.Count -eq 0) { exit 4 }  # nenhuma caixa disponível: sem som, sem erro

  foreach ($t in $targets) {
    $t.Dev.AudioEndpointVolume.MasterVolumeLevelScalar = $t.Vol / 100
    $t.Dev.AudioEndpointVolume.Mute = $false
  }
  if ($Action -eq 'volume') { exit 0 }
  if (-not $Wav -or -not (Test-Path $Wav)) { exit 3 }

  # WaveStream que repete a fonte sem emenda (loop contínuo).
  Add-Type -ReferencedAssemblies $Dll -TypeDefinition @'
using System;
using NAudio.Wave;
public class LoopStream : WaveStream {
  readonly WaveStream src;
  public LoopStream(WaveStream s) { src = s; }
  public override WaveFormat WaveFormat { get { return src.WaveFormat; } }
  public override long Length { get { return src.Length; } }
  public override long Position { get { return src.Position; } set { src.Position = value; } }
  public override int Read(byte[] buffer, int offset, int count) {
    int total = 0;
    while (total < count) {
      int n = src.Read(buffer, offset + total, count - total);
      if (n == 0) { if (src.Position == 0) break; src.Position = 0; }
      total += n;
    }
    return total;
  }
}
'@

  # Um reader + WasapiOut por caixa (mesmo arquivo); Play() em todas e espera
  # enquanto qualquer uma ainda estiver tocando.
  $players = @()
  try {
    foreach ($t in $targets) {
      $reader = New-Object NAudio.Wave.AudioFileReader $Wav
      $source = if ($Loop) { New-Object LoopStream $reader } else { $reader }
      $out = New-Object NAudio.Wave.WasapiOut($t.Dev, [NAudio.CoreAudioApi.AudioClientShareMode]::Shared, $false, 200)
      $out.Init($source)
      $players += , @{ Out = $out; Reader = $reader }
    }
    foreach ($p in $players) { $p.Out.Play() }
    do {
      Start-Sleep -Milliseconds 100
      $any = $false
      foreach ($p in $players) {
        if ($p.Out.PlaybackState -eq [NAudio.Wave.PlaybackState]::Playing) { $any = $true }
      }
    } while ($any)
  } finally {
    foreach ($p in $players) {
      try { $p.Out.Dispose() } catch {}
      try { $p.Reader.Dispose() } catch {}
    }
  }
  exit 0
} catch {
  exit 1
}
