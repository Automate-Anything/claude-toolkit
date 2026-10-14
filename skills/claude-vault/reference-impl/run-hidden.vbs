' Runs vault.mjs with no visible window (used by the scheduled task). Output goes to %USERPROFILE%\.claude-vault\sync.log
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "sync"
If WScript.Arguments.Count > 0 Then cmd = WScript.Arguments(0)
sh.Run "cmd /c node """ & dir & "\vault.mjs"" " & cmd, 0, False
