param([Parameter(Position=0)][string]$FilePath)

if (-not $env:AZURE_CLIENT_ID) {
    Write-Host "No Azure credentials - skipping code signing for $FilePath"
    exit 0
}

$dlib = $env:AZURE_DLIB_PATH
if (-not $dlib -or -not (Test-Path $dlib)) {
    Write-Host "Azure.CodeSigning.Dlib.dll not found at '$dlib' - skipping"
    exit 0
}

$metadata = Join-Path $PSScriptRoot "azure-signing-metadata.json"

& signtool.exe sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $dlib /dmdf $metadata $FilePath
if ($LASTEXITCODE -ne 0) { throw "Signing failed for $FilePath (exit $LASTEXITCODE)" }
