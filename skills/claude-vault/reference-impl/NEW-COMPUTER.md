# New computer in one minute

Copy the block below, paste it to the Claude agent on the new Windows computer, and answer its
two questions (the GitHub browser login, and the vault passphrase). Everything else is automatic:
chats, settings, hooks, skills, project repos, `.env` files, open chat tabs, the background sync,
the VS Code companion.

````
Set up my Claude Code vault on this Windows computer so it becomes a copy of my other machines. Do every step yourself in a terminal; stop only for the two things that need me (the GitHub browser login and the vault passphrase). Do not improvise; this sequence is tested.

1. Install what is missing (skip what exists): 
   winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
   winget install -e --id GitHub.cli --accept-source-agreements --accept-package-agreements
   winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
   winget install -e --id Microsoft.VisualStudioCode --accept-source-agreements --accept-package-agreements
   Then open a NEW terminal so PATH picks them up (or add C:\Program Files\Git\cmd, C:\Program Files\GitHub CLI, C:\Program Files\nodejs and %LOCALAPPDATA%\Programs\Microsoft VS Code\bin to PATH for this session). Node must be 22.13 or newer (`node --version`).
   Install the Claude Code extension: code --install-extension anthropic.claude-code

2. Log gh into GitHub as <your-github-user>: gh auth login --hostname github.com --git-protocol https --web
   Show me the one-time code and the URL, wait until `gh auth status` says logged in as <your-github-user>.

3. Clone the vault to exactly this path: gh repo clone <your-github-user>/<your-vault-repo> C:\claude-vault -- -b vault

4. Ask me for the vault passphrase, then store it (PowerShell, exactly; put the passphrase between the quotes):
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude-vault" | Out-Null
   ConvertTo-SecureString -String '<PASSPHRASE>' -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Encoding ascii -LiteralPath "$env:USERPROFILE\.claude-vault\key.dpapi"
   Verify: node C:\claude-vault\vault.mjs status  must print the snapshot summary. "Wrong passphrase" = retype step 4.

5. Run: node C:\claude-vault\vault.mjs setup
   It restores everything into %USERPROFILE%\.claude and C:\dev\<project> (cloning every project repo in place), installs the scheduled tasks (a full sync every 2 min, plus a sync and the reopen watcher at logon) and the VS Code companion extension. Takes a few minutes. Report the last 10 lines.

6. Verify and report: node C:\claude-vault\vault.mjs verify 30 (expect 0 differ); the folders in C:\dev; `schtasks /Query /TN ClaudeVaultPull`, ClaudeVaultSyncAtLogon, ClaudeVaultWatch present (ClaudeVaultSync is retired and should NOT exist); `code --list-extensions` shows anthropic.claude-code and claude-vault.claude-vault-companion. Then tell me to open VS Code on any C:\dev project and log the Claude Code extension into my account.

Rules: keep the paths exactly as written (C:\claude-vault, C:\dev\<project>); never edit, commit to or push the vault repo by hand (only vault.mjs writes to it); never create %USERPROFILE%\.claude-vault\squash-here on this machine; do not run gh auth setup-git or change global git credential settings; the passphrase goes only into the DPAPI file in step 4.
````

## The one rule to remember

One chat on one machine at a time, and one repo on one machine at a time. Chats are whole
files (newest copy wins); two trees edited at the same time are a conflict the vault refuses to
merge (a toast tells you which files, nothing is overwritten). Everything else is automatic:
chats and their latest messages, open chat tabs, `.env` files, repos, AND uncommitted or
unpushed code follow you within about 2 minutes, with no agent or human needed on the machine
you left.

Your passphrase is not in this file on purpose (the tool files in the vault are not encrypted,
only the data is). Keep it in your password manager.
