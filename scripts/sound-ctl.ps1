# Controla a reprodução de um som SOMENTE no dispositivo escolhido (endpoint WASAPI
# direto, via NAudio) — sem trocar o dispositivo padrão. Modos:
#   -Action play   → toca -Wav (opcional -Loop, sem emenda) até o processo ser morto
#   -Action volume → só ajusta o volume do endpoint e sai
#   -Action list   → imprime os endpoints de saída ativos (um por linha, UTF-8) e sai
# Parar = matar este processo (o Node faz isso via child.kill()).
param(
  [Parameter(Mandatory = $true)][string]$Dll,
  [string]$DeviceMatch = 'SoundCore 2',
  [ValidateSet('play', 'volume', 'list')][string]$Action = 'play',
  [string]$Wav,
  [int]$Volume = 40,
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

  # Nome exato primeiro (config aponta um endpoint específico); senão casa por
  # trecho, excluindo o perfil Headset/Hands-Free do Bluetooth (mono, qualidade
  # ruim) — de "SoundCore 2" queremos o A2DP "Fones de ouvido (SoundCore 2)".
  $dev = $all | Where-Object { $_.FriendlyName -eq $DeviceMatch } | Select-Object -First 1
  if (-not $dev) {
    $dev = $all |
      Where-Object { $_.FriendlyName -match [regex]::Escape($DeviceMatch) -and $_.FriendlyName -notmatch 'Headset|Hands' } |
      Select-Object -First 1
  }
  if (-not $dev) { exit 4 }  # dispositivo desconectado: sem som, sem erro

  $vol = [Math]::Max(0, [Math]::Min(100, $Volume)) / 100
  $dev.AudioEndpointVolume.MasterVolumeLevelScalar = $vol
  $dev.AudioEndpointVolume.Mute = $false

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

  $reader = New-Object NAudio.Wave.AudioFileReader $Wav
  $source = if ($Loop) { New-Object LoopStream $reader } else { $reader }
  $out = New-Object NAudio.Wave.WasapiOut($dev, [NAudio.CoreAudioApi.AudioClientShareMode]::Shared, $false, 200)
  try {
    $out.Init($source)
    $out.Play()
    while ($out.PlaybackState -eq [NAudio.Wave.PlaybackState]::Playing) { Start-Sleep -Milliseconds 100 }
  } finally {
    $out.Dispose(); $reader.Dispose()
  }
  exit 0
} catch {
  exit 1
}
