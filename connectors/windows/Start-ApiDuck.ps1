param(
    [switch]$FriendlyErrors,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ClaudeArgs
)
$ErrorActionPreference = 'Stop'
function Find-ClaudeCode {
    $command = Get-Command claude -ErrorAction SilentlyContinue
    if ($command) { return $command.Name }
    foreach ($path in @(
        (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
        (Join-Path $env:APPDATA 'npm\claude.cmd'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\claude.exe')
    )) {
        if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
    }
    return $null
}
function Get-ClaudeCode {
    $command = Find-ClaudeCode
    if ($command) { return $command }
    Write-Host 'ApiDuck setup: Claude Code needs to be installed once.'
    Write-Host 'Installer: Anthropic.ClaudeCode from the WinGet community repository.'
    $answer = Read-Host 'Install Claude Code now? [Y/n]'
    if ($answer -and $answer -notmatch '^(y|yes)$') {
        throw 'Setup cancelled. Run Start-ApiDuck.cmd when you are ready to install.'
    }
    $installer = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $installer) {
        Start-Process 'https://code.claude.com/docs/en/setup'
        throw 'WinGet is unavailable. Install Claude Code using the guide that opened, then run ApiDuck again.'
    }
    & $installer.Name install --id Anthropic.ClaudeCode --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Claude Code installation did not finish. Check the installer message above and try again.' }
    $command = Find-ClaudeCode
    if (-not $command) { throw 'Installation finished. Close this window and run Start-ApiDuck.cmd again to refresh PATH.' }
    return $command
}
try {
$baseUrl = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'gateway-url.txt'))).Trim()
$origin = [Uri]$baseUrl
if ($origin.Scheme -ne 'https' -or $origin.UserInfo -or $origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment) {
    throw 'The connector must contain an HTTPS gateway origin.'
}
$claudeCommand = Get-ClaudeCode
# Open the portal without putting credentials in the URL or saving them.
Start-Process "$baseUrl/#downloads"
. (Join-Path $PSScriptRoot 'Key-Entry.ps1')
$customerKey = Read-ApiDuckCustomerKey -Gateway $baseUrl
if ($customerKey -cnotmatch '^sk-gw-[a-f0-9]{64}$') {
    $customerKey = $null
    throw 'Use the individual customer key issued by ApiDuck, not a provider key.'
}
$names = @('ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY',
    'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
foreach ($family in @('OPUS', 'SONNET', 'HAIKU')) {
    $names += "ANTHROPIC_DEFAULT_${family}_MODEL_NAME"
    $names += "ANTHROPIC_DEFAULT_${family}_MODEL_DESCRIPTION"
}
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    try {
        $account = Invoke-RestMethod -Uri "$baseUrl/api/account" -Headers @{ Authorization = "Bearer $customerKey" } -TimeoutSec 20 -MaximumRedirection 0
    } catch { throw 'Account check failed. Check your key and portal connection; Claude Code was not started.' }
    if (-not $account.customer.id) { throw 'Invalid account response. Contact your seller.' }
    if ($account.inferenceEnabled -ne $true) {
        if ($account.serviceStatus.code -match '^[A-Z_]+$') {
            throw ('ApiDuck is temporarily unavailable. Your key was accepted. Contact your seller with code: ' + $account.serviceStatus.code)
        }
        throw 'Hosted inference is unavailable. Check your account on the portal or contact support.'
    }
    if ([string]$account.tokens.remaining -notmatch '^\d+$' -or [bigint]$account.tokens.remaining -le 0) {
        throw 'No available customer allowance. Open the portal to check your balance.'
    }
    $env:ANTHROPIC_BASE_URL = $baseUrl
    $env:ANTHROPIC_AUTH_TOKEN = $customerKey
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:ANTHROPIC_CUSTOM_HEADERS -ErrorAction SilentlyContinue
    $env:ANTHROPIC_MODEL = 'apiduck-fast'
    $env:ANTHROPIC_DEFAULT_OPUS_MODEL = 'apiduck-fast'
    $env:ANTHROPIC_DEFAULT_SONNET_MODEL = 'apiduck-fast'
    $env:ANTHROPIC_DEFAULT_HAIKU_MODEL = 'apiduck-fast'
    $env:CLAUDE_CODE_SUBAGENT_MODEL = 'apiduck-fast'
    foreach ($family in @('OPUS', 'SONNET', 'HAIKU')) {
        [Environment]::SetEnvironmentVariable("ANTHROPIC_DEFAULT_${family}_MODEL_NAME", 'ApiDuck Fast', 'Process')
        [Environment]::SetEnvironmentVariable("ANTHROPIC_DEFAULT_${family}_MODEL_DESCRIPTION", 'ApiDuck gateway service. Provider details are on your account portal.', 'Process')
    }
    $env:CLAUDE_CODE_MAX_OUTPUT_TOKENS = '4096'
    $env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    Write-Host "Connected through $baseUrl. Balance and revocation are enforced by the hosted gateway."
    & $claudeCommand @ClaudeArgs
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Claude Code exited with code $LASTEXITCODE." }
} finally {
    $customerKey = $null
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
} catch {
    if (-not $FriendlyErrors) { throw }
    Write-Host ''
    Write-Host ('ApiDuck: ' + $_.Exception.Message) -ForegroundColor Yellow
    exit 1
}
