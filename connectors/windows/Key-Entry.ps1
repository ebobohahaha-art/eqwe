Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function New-ApiDuckKeyDialog {
    param([string]$Gateway, [scriptblock]$ReadClipboard = { [Windows.Forms.Clipboard]::GetText() })
    $form = New-Object Windows.Forms.Form
    $form.Text = 'Connect to ApiDuck'
    $form.ClientSize = New-Object Drawing.Size(560, 268)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.Font = New-Object Drawing.Font('Segoe UI', 10)
    $heading = New-Object Windows.Forms.Label
    $heading.Text = 'Paste your customer key to connect'
    $heading.SetBounds(24, 20, 510, 28)
    $heading.Font = New-Object Drawing.Font('Segoe UI', 13, [Drawing.FontStyle]::Bold)
    $hostLabel = New-Object Windows.Forms.Label
    $hostLabel.Text = $Gateway
    $hostLabel.SetBounds(24, 54, 510, 24)
    $keyBox = New-Object Windows.Forms.TextBox
    $keyBox.Name = 'customerKey'
    $keyBox.SetBounds(24, 92, 410, 30)
    $keyBox.UseSystemPasswordChar = $true
    $keyBox.ShortcutsEnabled = $true
    $paste = New-Object Windows.Forms.Button
    $paste.Text = 'Paste'
    $paste.SetBounds(446, 90, 90, 32)
    $show = New-Object Windows.Forms.CheckBox
    $show.Text = 'Show key'
    $show.SetBounds(24, 132, 160, 26)
    $hint = New-Object Windows.Forms.Label
    $hint.Text = 'Use Ctrl+V or Paste. Your key is used for this session and is not saved.'
    $hint.SetBounds(24, 166, 512, 42)
    $connect = New-Object Windows.Forms.Button
    $connect.Text = 'Connect'
    $connect.SetBounds(326, 218, 100, 32)
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = 'Cancel'
    $cancel.SetBounds(436, 218, 100, 32)
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.AcceptButton = $connect
    $form.CancelButton = $cancel
    $form.Controls.AddRange(@($heading, $hostLabel, $keyBox, $paste, $show, $hint, $connect, $cancel))
    $paste.Add_Click({
        try { $keyBox.Text = ([string](& $ReadClipboard)).Trim(); $keyBox.Focus(); $keyBox.SelectionStart = $keyBox.TextLength }
        catch { $hint.Text = 'Clipboard unavailable. Click the key field and use Ctrl+V.' }
    }.GetNewClosure())
    $show.Add_CheckedChanged({ $keyBox.UseSystemPasswordChar = -not $show.Checked }.GetNewClosure())
    $connect.Add_Click({
        $keyBox.Text = $keyBox.Text.Trim()
        if ($keyBox.Text -cnotmatch '^sk-gw-[a-f0-9]{64}$') {
            $hint.ForeColor = [Drawing.Color]::Firebrick
            $hint.Text = 'Paste the complete customer key from your purchase, starting with sk-gw-.'
            $keyBox.Focus()
            return
        }
        $form.DialogResult = [Windows.Forms.DialogResult]::OK
        $form.Close()
    }.GetNewClosure())
    $form.Add_Shown({ $keyBox.Focus() }.GetNewClosure())
    return $form
}

function Read-ApiDuckCustomerKey {
    param([string]$Gateway)
    [Windows.Forms.Application]::EnableVisualStyles()
    $dialog = New-ApiDuckKeyDialog -Gateway $Gateway
    try {
        if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) {
            throw 'Connection cancelled. No customer key was sent.'
        }
        return $dialog.Controls['customerKey'].Text.Trim()
    } finally {
        $dialog.Controls['customerKey'].Clear()
        $dialog.Dispose()
    }
}
