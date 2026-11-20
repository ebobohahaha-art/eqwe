# ApiDuck customer connector

Each customer uses their own sk-gw customer key and independent hosted balance.
The same download works for every customer. Reinstalling never resets a balance.
Install the official Claude Code CLI: https://code.claude.com/docs/en/setup

Windows: extract the ZIP, double-click Start-ApiDuck.cmd and enter your customer
key at the hidden prompt. Or open PowerShell in your project folder and run:

    & 'C:\path\to\Start-ApiDuck.ps1'

Linux/macOS: extract the ZIP, open your project in a terminal, and run:

    bash /path/to/start-apiduck.sh

Linux/macOS also requires curl and Node.js 22+. Ordinary Claude Code options can
follow the script path. Avoid options that override the gateway configuration.
The connector opens your seller's portal, checks the key and available balance,
and starts Claude Code through the gateway. It does not save your key or change
global settings. The portal requires separate login: keys never enter browser URLs.

Use only trusted HTTPS seller downloads. The gateway is in gateway-url.txt;
SHA256SUMS.txt contains archive checksums. No admin/provider key is distributed.

10M ApiDuck credits represent a $0.20 provider-cost allowance under the verified
server policy, not 10M DeepSeek tokens. Input, cache and output use different
credit amounts. Large requests can stop early because the server must reserve
their maximum verified cost. Your purchase price and hosting fees are separate.
If inference is unavailable or your account check fails, Claude is not started.
