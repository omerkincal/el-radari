$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'Radar.cs') -ReferencedAssemblies System.dll,System.Drawing.dll,System.Windows.Forms.dll
[Radar]::Run($PSScriptRoot)
