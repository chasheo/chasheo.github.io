Option Explicit
Dim shell, fso, root, command, powershell
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
command = Quote(powershell) & " -NoProfile -NonInteractive -WindowStyle Hidden -File " & Quote(root & "\start-demo.ps1")
If WScript.Arguments.Count > 0 Then command = command & " -ConfigPath " & Quote(WScript.Arguments(0))
If WScript.Arguments.Count > 1 Then command = command & " -PythonPath " & Quote(WScript.Arguments(1))
shell.CurrentDirectory = root
shell.Run command, 0, False
Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
