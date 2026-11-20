import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));

test('Download ZIPs contain only allowlisted files, correct origin and valid checksums', () => {
  const build=spawnSync(process.execPath,['scripts/package-connectors.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  const sums=readFileSync(join(root,'public/downloads/SHA256SUMS.txt'),'utf8');
  for(const platform of ['windows','linux']) {
    const archive=readFileSync(join(root,`public/downloads/apiduck-${platform}.zip`));
    const files=new Map(); let offset=0;
    while(archive.readUInt32LE(offset)===0x04034b50) {
      const size=archive.readUInt32LE(offset+18), length=archive.readUInt16LE(offset+26);
      const start=offset+30+length;
      files.set(archive.subarray(offset+30,start).toString(),archive.subarray(start,start+size).toString());
      offset=start+size;
    }
    assert.equal(archive.readUInt32LE(offset),0x02014b50);
    assert.equal(files.size,platform==='windows'?6:4);
    const settings=JSON.parse(files.get('claude-settings.json'));
    assert.equal(settings.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,'100000');
    assert.equal(settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,'100000');
    assert.equal(files.get('gateway-url.txt').trim(),new URL(process.env.PUBLIC_ORIGIN||'https://apily.netlify.app').origin);
    for(const content of files.values()) assert.doesNotMatch(content,/sk-admin-[a-f0-9]{64}|sk-gw-[a-f0-9]{64}|DEEPSEEK_API_KEY=/);
    for(const content of files.values()) assert.doesNotMatch(content,/deepseek/i);
    assert.match(sums,new RegExp(`[a-f0-9]{64}  apiduck-${platform}\\.zip`));
    assert.ok(sums.includes(`${createHash('sha256').update(archive).digest('hex')}  apiduck-${platform}.zip`));
  }
  const bad=spawnSync(process.execPath,['scripts/package-connectors.mjs'],{cwd:root,encoding:'utf8',env:{...process.env,PUBLIC_ORIGIN:'http://untrusted.test'}});
  assert.notEqual(bad.status,0);
});

test('Windows setup finds existing installations and handles install/decline/failure paths', {skip:process.platform!=='win32'}, () => {
  const temp=mkdtempSync(join(tmpdir(),'apiduck-setup-test-'));
  try {
    const script=readFileSync(join(root,'connectors/windows/Start-ApiDuck.ps1'),'utf8').replace(/\r\n/g,'\n');
    const boundary=script.indexOf('\ntry {\n');
    assert.ok(boundary>0);
    writeFileSync(join(temp,'setup.ps1'),script.slice(0,boundary));
    writeFileSync(join(temp,'test.ps1'),String.raw`
param([string]$Scenario)
$ErrorActionPreference='Stop'
$global:setupInstalled=$false
$global:setupPrompted=$false
function Get-Command {
  param($Name,$ErrorAction)
  if($Name -eq 'claude' -and ($Scenario -eq 'existing' -or ($global:setupInstalled -and $Scenario -ne 'restart'))) {return @{Name='claude'}}
  if($Name -eq 'winget' -and $Scenario -ne 'unavailable') {return @{Name='winget'}}
}
function Test-Path { param($LiteralPath,$PathType) return ($Scenario -eq 'outsidepath' -and $LiteralPath.EndsWith('.local\bin\claude.exe')) }
function Read-Host { param($Prompt) $global:setupPrompted=$true; if($Scenario -eq 'declined') {return 'n'}; return 'y' }
function Start-Process {param($FilePath) if($FilePath -ne 'https://code.claude.com/docs/en/setup') {throw 'Wrong setup URL'}}
function winget {
  if(($args -join ' ') -notmatch 'install --id Anthropic.ClaudeCode --exact --source winget') {throw 'Wrong package'}
  Write-Output 'Installer progress must not become part of executable path'
  $global:setupInstalled=$true
  $global:LASTEXITCODE=$(if($Scenario -eq 'installfail') {13} else {0})
}
. (Join-Path $PSScriptRoot 'setup.ps1')
$failed=$false; $command=$null
try {$command=Get-ClaudeCode} catch {$failed=$true}
$success=$Scenario -in @('existing','outsidepath','install')
if($success -eq $failed) {throw 'Incorrect setup outcome'}
if($success -and ($command -isnot [string] -or -not $command)) {throw 'Installer output polluted command'}
if($Scenario -in @('existing','outsidepath') -and $global:setupPrompted) {throw 'Existing install prompted for installation'}
if($Scenario -in @('declined','unavailable') -and $global:setupInstalled) {throw 'Unexpected installation'}
`);
    for(const scenario of ['existing','outsidepath','install','declined','unavailable','installfail','restart']) {
      const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(temp,'test.ps1'),scenario],{encoding:'utf8',env:{...process.env,PSModulePath:join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')}});
      assert.equal(result.status,0,`${scenario}: ${result.stderr}`);
    }
  } finally {rmSync(temp,{recursive:true,force:true});}
});

test('Windows launcher configures only valid funded accounts and restores the original environment', {skip:process.platform!=='win32'}, () => {
  const temp=mkdtempSync(join(tmpdir(),'apiduck-connector-test-'));
  try {
    copyFileSync(join(root,'connectors/windows/Start-ApiDuck.ps1'),join(temp,'Start-ApiDuck.ps1'));
    copyFileSync(join(root,'connectors/claude-settings.json'),join(temp,'claude-settings.json'));
    writeFileSync(join(temp,'Key-Entry.ps1'),String.raw`function Read-ApiDuckCustomerKey { param($Gateway) if($Gateway -ne 'https://gateway.test') {throw 'Wrong key dialog gateway'}; if($Scenario -eq 'cancel') {throw 'Cancelled'}; if($Scenario -eq 'invalid') {return 'bad-key'}; return ('sk-gw-'+('a'*64)) }`);
    writeFileSync(join(temp,'gateway-url.txt'),'https://gateway.test\n');
    const harness=String.raw`
param([string]$Scenario)
$ErrorActionPreference='Stop'
$global:connectorLaunched=$false
$global:connectorOpened=$false
$global:connectorChecked=$false
$env:ANTHROPIC_BASE_URL='https://previous.test'
$env:ANTHROPIC_AUTH_TOKEN='previous-auth'
$env:ANTHROPIC_API_KEY='previous-key'
function Start-Process { param($FilePath) if ($FilePath -ne 'https://gateway.test/#downloads') { throw 'Wrong portal' }; $global:connectorOpened=$true }
function Read-Host { param($Prompt,[switch]$AsSecureString) if(-not $AsSecureString) {throw 'Visible key prompt'}; if($Scenario -eq 'invalid') {return (ConvertTo-SecureString 'bad-key' -AsPlainText -Force)}; ConvertTo-SecureString ('sk-gw-'+('a'*64)) -AsPlainText -Force }
function Invoke-RestMethod {
  param($Uri,$Headers,$TimeoutSec,$MaximumRedirection)
  $global:connectorChecked=$true
  if($Uri -ne 'https://gateway.test/api/account' -or $MaximumRedirection -ne 0) {throw 'Unsafe account target'}
  if($Headers.Authorization -cne ('Bearer sk-gw-'+('a'*64))) {throw 'Wrong auth'}
  if($Scenario -eq 'revoked') {throw '401'}
  @{customer=@{id='customer'};inferenceEnabled=($Scenario -ne 'disabled');tokens=@{remaining=$(if($Scenario -eq 'empty') {'0'} else {'10000000'})}}
}
function claude {
  if($env:ANTHROPIC_BASE_URL -ne 'https://gateway.test' -or $env:ANTHROPIC_AUTH_TOKEN -cne ('sk-gw-'+('a'*64))) {throw 'Wrong gateway'}
  if($env:ANTHROPIC_API_KEY -or $env:ANTHROPIC_MODEL -ne 'apiduck-fast' -or $env:CLAUDE_CODE_MAX_OUTPUT_TOKENS -ne '4096') {throw 'Wrong settings'}
  if($env:ANTHROPIC_DEFAULT_SONNET_MODEL_NAME -ne 'ApiDuck Fast') {throw 'Wrong display name'}
  if($args[0] -ne '--settings' -or -not (Test-Path -LiteralPath $args[1]) -or $args[2] -ne '--version') {throw 'Lost CLI settings or arguments'}
  if($env:CLAUDE_CODE_MAX_CONTEXT_TOKENS -ne '100000' -or $env:CLAUDE_CODE_AUTO_COMPACT_WINDOW -ne '100000') {throw 'Wrong context configuration'}
  $global:connectorLaunched=$true
}
$failed=$false
try { & (Join-Path $PSScriptRoot 'Start-ApiDuck.ps1') '--version' } catch { $failed=$true; if ($Scenario -eq 'valid') { throw } }
if($env:ANTHROPIC_BASE_URL -ne 'https://previous.test' -or $env:ANTHROPIC_AUTH_TOKEN -ne 'previous-auth' -or $env:ANTHROPIC_API_KEY -ne 'previous-key') {throw 'Environment was not restored'}
if(-not $global:connectorOpened) {throw 'Portal not opened'}
if($Scenario -eq 'valid') { if(-not $global:connectorLaunched -or $failed) {throw 'Valid account failed'} }
else {if($global:connectorLaunched -or -not $failed) {throw 'Blocked account launched'}}
if($Scenario -in @('invalid','cancel') -and $global:connectorChecked) {throw 'Unsubmitted key sent over network'}
`;
    writeFileSync(join(temp,'test.ps1'),harness);
    for(const scenario of ['valid','invalid','cancel','revoked','disabled','empty']) {
      const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(temp,'test.ps1'),scenario],{encoding:'utf8',env:{...process.env,PSModulePath:join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')}});
      assert.equal(result.status,0,`${scenario}: ${result.stderr}`);
      assert.doesNotMatch(result.stdout,/sk-gw-[a-f0-9]{64}/);
    }
  } finally {rmSync(temp,{recursive:true,force:true});}
});
