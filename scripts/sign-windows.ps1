param([Parameter(Position=0)][string]$FilePath)

if (-not $env:AZURE_CLIENT_ID) {
    Write-Host "No Azure credentials - skipping code signing for $FilePath"
    exit 0
}

$dlibPath = Join-Path $env:USERPROFILE ".dotnet\tools\.store\azure.codesigning.dlib\1.0.52\azure.codesigning.dlib\1.0.52\tools\net8.0\any\Azure.CodeSigning.Dlib.dll"
$metadata = Join-Path $PSScriptRoot "azure-signing-metadata.json"

& signtool.exe sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $dlibPath /dmdf $metadata $FilePath
if ($LASTEXITCODE -ne 0) { throw "Signing failed for $FilePath (exit $LASTEXITCODE)" }
