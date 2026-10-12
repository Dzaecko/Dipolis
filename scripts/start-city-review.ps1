param(
    [Parameter(Mandatory = $true)][string]$Protocol,
    [ValidateSet('fake', 'openai')][string]$Adapter = 'fake',
    [switch]$Overwrite
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$previous = @{}
$previousPath = $env:Path
Push-Location $root
try {
    $env:Path = (@($previousPath, [Environment]::GetEnvironmentVariable('Path', 'User'),
        [Environment]::GetEnvironmentVariable('Path', 'Machine')) | Where-Object { $_ }) -join ';'
    $corepack = Get-Command corepack.cmd -CommandType Application -ErrorAction SilentlyContinue
    if (!$corepack) { throw 'Node.js 22+ mit Corepack fehlt.' }
    if ($Adapter -eq 'openai') {
        $configPath = Join-Path $root '.env.city-model'
        if (!(Test-Path $configPath)) { throw 'Konfiguration .env.city-model fehlt; CITY_MODEL_* und CITY_JUDGE_* sind erforderlich.' }
        $suffixes = @('ENDPOINT', 'NAME', 'MODEL', 'KEY', 'API', 'AUTH', 'TOKEN_SCOPE',
            'TIMEOUT_MS', 'MAX_RETRIES', 'MAX_TOKENS', 'REASONING_EFFORT')
        $runOnly = @('CITY_MODEL_ASSIGNMENT', 'CITY_MODEL_RUN', 'CITY_MODEL_START_MAP', 'CITY_MODEL_SEED', 'CITY_MODEL_PROFILE')
        $config = @{}
        foreach ($line in [IO.File]::ReadAllLines($configPath)) {
            $text = $line.Trim()
            if (!$text -or $text.StartsWith('#')) { continue }
            if ($text -notmatch '^([A-Z_]+)\s*=(.*)$') { throw 'Ungueltige Konfigurationszeile: NAME=WERT erwartet.' }
            $name = $Matches[1]; $value = $Matches[2].Trim()
            if ($runOnly -contains $name) { continue }
            if ($name -notmatch '^CITY_(MODEL|JUDGE)_(.+)$' -or $suffixes -notcontains $Matches[2]) {
                throw "Unbekannte Einstellung: $name"
            }
            if ($config.ContainsKey($name)) { throw "Doppelte Einstellung: $name" }
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
            $config[$name] = $value
        }
        foreach ($prefix in @('CITY_MODEL_', 'CITY_JUDGE_')) {
            foreach ($suffix in $suffixes) {
                $name = $prefix + $suffix
                $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
                [Environment]::SetEnvironmentVariable($name, $config[$name], 'Process')
            }
        }
        Write-Host 'Nachbetrachtung wird gestartet. Zusaetzliche Modellkosten koennen entstehen.'
    }
    $protocolPath = (Resolve-Path -LiteralPath $Protocol).Path
    $reviewArgs = @('--protocol', $protocolPath, '--adapter', $Adapter)
    if ($Overwrite) { $reviewArgs += '--overwrite' }
    & $corepack.Source pnpm --filter dipolis run city-review @reviewArgs
    if ($LASTEXITCODE -ne 0) { throw 'Nachbetrachtung fehlgeschlagen. Siehe Terminalausgabe und review.json.' }
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    $env:Path = $previousPath
    Pop-Location
}
