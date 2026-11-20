param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ClaudeArgs)
$ErrorActionPreference = 'Stop'
$baseUrl = ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'gateway-url.txt'))).Trim()
$origin = [Uri]$baseUrl
if ($origin.Scheme -ne 'https' -or $origin.UserInfo -or $origin.AbsolutePath -ne '/' -or $origin.Query -or $origin.Fragment) {
    throw 'The connector must contain an HTTPS gateway origin.'
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Start-Process 'https://code.claude.com/docs/en/setup'
    throw 'Install the official Claude Code CLI, then run this connector again.'
}
# Open the portal without putting credentials in the URL or saving them.
Start-Process "$baseUrl/#downloads"
$secureKey = Read-Host 'Enter your customer API key (sk-gw-...)' -AsSecureString
$customerKey = [Net.NetworkCredential]::new('', $secureKey).Password
if ($customerKey -cnotmatch '^sk-gw-[a-f0-9]{64}$') {
    $customerKey = $null
    throw 'Use the individual customer key issued by ApiDuck, not a provider key.'
}
$names = @('ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY',
    'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    try {
        $account = Invoke-RestMethod -Uri "$baseUrl/api/account" -Headers @{ Authorization = "Bearer $customerKey" } -TimeoutSec 20 -MaximumRedirection 0
    } catch { throw 'Account check failed. Check your key and portal connection; Claude Code was not started.' }
    if (-not $account.customer.id -or $account.inferenceEnabled -ne $true) {
        throw 'Hosted inference is unavailable. Check your account on the portal or contact support.'
    }
    if ([string]$account.tokens.remaining -notmatch '^\d+$' -or [bigint]$account.tokens.remaining -le 0) {
        throw 'No available customer allowance. Open the portal to check your balance.'
    }
    $env:ANTHROPIC_BASE_URL = $baseUrl
    $env:ANTHROPIC_AUTH_TOKEN = $customerKey
    Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:ANTHROPIC_CUSTOM_HEADERS -ErrorAction SilentlyContinue
    $env:ANTHROPIC_MODEL = 'deepseek-flash'
    $env:ANTHROPIC_DEFAULT_OPUS_MODEL = 'deepseek-flash'
    $env:ANTHROPIC_DEFAULT_SONNET_MODEL = 'deepseek-flash'
    $env:ANTHROPIC_DEFAULT_HAIKU_MODEL = 'deepseek-flash'
    $env:CLAUDE_CODE_SUBAGENT_MODEL = 'deepseek-flash'
    $env:CLAUDE_CODE_MAX_OUTPUT_TOKENS = '4096'
    $env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    Write-Host "Connected through $baseUrl. Balance and revocation are enforced by the hosted gateway."
    & claude @ClaudeArgs
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Claude Code exited with code $LASTEXITCODE." }
} finally {
    $customerKey = $null
    $secureKey = $null
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
