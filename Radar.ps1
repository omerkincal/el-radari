$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'Radar.cs')
[Radar]::Run($PSScriptRoot)
