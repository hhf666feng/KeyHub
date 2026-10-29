$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$version = (Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json).version
$packageName = "KeyHub_${version}_windows-x64"
$releaseExe = if ($env:KEYHUB_RELEASE_EXE) {
  [System.IO.Path]::GetFullPath($env:KEYHUB_RELEASE_EXE)
} elseif ($env:OPENKEYLET_RELEASE_EXE) {
  [System.IO.Path]::GetFullPath($env:OPENKEYLET_RELEASE_EXE)
} elseif ($env:CARGO_TARGET_DIR) {
  Join-Path $env:CARGO_TARGET_DIR "release\keyhub.exe"
} else {
  Join-Path $projectRoot "src-tauri\target\release\keyhub.exe"
}
$distRoot = if ($env:KEYHUB_DIST_ROOT) {
  [System.IO.Path]::GetFullPath($env:KEYHUB_DIST_ROOT)
} elseif ($env:OPENKEYLET_DIST_ROOT) {
  [System.IO.Path]::GetFullPath($env:OPENKEYLET_DIST_ROOT)
} else {
  Join-Path $projectRoot "dist"
}
$stageRoot = Join-Path $distRoot ".portable-stage"
$packageRoot = Join-Path $stageRoot $packageName
$archivePath = Join-Path $distRoot "${packageName}-portable.zip"
$checksumPath = "${archivePath}.sha256"

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $releaseExe -PathType Leaf)) {
  throw "Release executable is missing. Run npm run build first."
}

$resolvedDistRoot = [System.IO.Path]::GetFullPath($distRoot)
$resolvedStageRoot = [System.IO.Path]::GetFullPath($stageRoot)
if (-not $resolvedStageRoot.StartsWith($resolvedDistRoot + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Portable staging path escaped the dist directory."
}

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
Copy-Item -LiteralPath $releaseExe -Destination (Join-Path $packageRoot "keyhub.exe")
foreach ($alias in @("openkeylet.exe", "kru.exe")) {
  Copy-Item -LiteralPath (Join-Path $packageRoot "keyhub.exe") -Destination (Join-Path $packageRoot $alias)
}
Copy-Item -LiteralPath (Join-Path $projectRoot "README.md") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "README.zh-CN.md") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "SECURITY.md") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "SECURITY.zh-CN.md") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "PRIVACY.md") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "PRIVACY.zh-CN.md") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "LICENSE") -Destination $packageRoot
New-Item -ItemType Directory -Path (Join-Path $packageRoot "docs") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot ".github\assets") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "docs\guide.md") -Destination (Join-Path $packageRoot "docs")
Copy-Item -LiteralPath (Join-Path $projectRoot "docs\guide.zh-CN.md") -Destination (Join-Path $packageRoot "docs")
Copy-Item -LiteralPath (Join-Path $projectRoot "docs\chrome-web-store") -Destination (Join-Path $packageRoot "docs") -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot ".github\assets\keyhub-hero.svg") -Destination (Join-Path $packageRoot ".github\assets")
Copy-Item -LiteralPath (Join-Path $projectRoot "browser-extension") -Destination $packageRoot -Recurse

$checksums = Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
  Sort-Object FullName |
  ForEach-Object {
    $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace("\", "/")
    "$(Get-Sha256 $_.FullName)  $relative"
  }
Set-Content -LiteralPath (Join-Path $packageRoot "SHA256SUMS.txt") -Encoding ascii -Value $checksums

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -CompressionLevel Optimal
$archiveHash = Get-Sha256 $archivePath
Set-Content -LiteralPath $checksumPath -Encoding ascii -Value "$archiveHash  $([System.IO.Path]::GetFileName($archivePath))"
Remove-Item -LiteralPath $stageRoot -Recurse -Force

Get-Item -LiteralPath $archivePath, $checksumPath |
  Select-Object FullName, Length
