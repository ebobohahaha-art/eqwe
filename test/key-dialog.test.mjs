import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));

test('Customer key dialog supports paste, visibility, validation and cancellation without storing keys', {skip:process.platform!=='win32'}, () => {
  const temp=mkdtempSync(join(tmpdir(),'apiduck-key-dialog-test-'));
  try {
    writeFileSync(join(temp,'test.ps1'),String.raw`
param([string]$DialogScript)
$ErrorActionPreference='Stop'
. $DialogScript
$dialog=New-ApiDuckKeyDialog -Gateway 'https://apily.netlify.app' -ReadClipboard { '  sk-gw-'+('a'*64)+'  ' }
try {
  $keyBox=$dialog.Controls['customerKey']
  $paste=@($dialog.Controls | Where-Object {$_.Text -eq 'Paste'})[0]
  $show=@($dialog.Controls | Where-Object {$_.Text -eq 'Show key'})[0]
  $connect=@($dialog.Controls | Where-Object {$_.Text -eq 'Connect'})[0]
  $cancel=@($dialog.Controls | Where-Object {$_.Text -eq 'Cancel'})[0]
  if(-not $keyBox.UseSystemPasswordChar -or -not $keyBox.ShortcutsEnabled) {throw 'Input must allow paste and start masked'}
  # Invoke the real WinForms click events without displaying a test window or
  # touching the user's clipboard. The clipboard reader above is synthetic.
  $click=[Windows.Forms.Button].GetMethod('OnClick',[Reflection.BindingFlags]'Instance,NonPublic')
  $click.Invoke($paste,@([EventArgs]::Empty)) | Out-Null
  if($keyBox.Text -cne ('sk-gw-'+('a'*64))) {throw 'Paste did not trim and populate key'}
  $show.Checked=$true
  if($keyBox.UseSystemPasswordChar) {throw 'Show key did not reveal input'}
  $show.Checked=$false
  if(-not $keyBox.UseSystemPasswordChar) {throw 'Hide key failed'}
  $keyBox.Text='short-key'
  $click.Invoke($connect,@([EventArgs]::Empty)) | Out-Null
  if($dialog.DialogResult -eq [Windows.Forms.DialogResult]::OK) {throw 'Malformed key was accepted'}
  if(-not @($dialog.Controls | Where-Object {$_.Text -like 'Paste the complete*'}).Count) {throw 'Validation message missing'}
  if($cancel.DialogResult -ne [Windows.Forms.DialogResult]::Cancel) {throw 'Cancellation unavailable'}
  $keyBox.Text=' sk-gw-'+('a'*64)+' '
  $click.Invoke($connect,@([EventArgs]::Empty)) | Out-Null
  if($dialog.DialogResult -ne [Windows.Forms.DialogResult]::OK) {throw 'Valid pasted key rejected'}
} finally { $dialog.Dispose() }
`);
    const result=spawnSync('powershell.exe',['-STA','-NoProfile','-ExecutionPolicy','Bypass','-File',join(temp,'test.ps1'),join(root,'connectors/windows/Key-Entry.ps1')],{encoding:'utf8',env:{...process.env,PSModulePath:join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')}});
    assert.equal(result.status,0,result.stderr);
    assert.doesNotMatch(result.stdout,/sk-gw-[a-f0-9]{64}/);
  } finally { rmSync(temp,{recursive:true,force:true}); }
});
