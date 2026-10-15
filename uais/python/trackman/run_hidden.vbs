' Runs run_nightly.bat with no console window (Task Scheduler starts this via wscript.exe).
' Usage: wscript.exe run_hidden.vbs backfill --year 2025
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
args = ""
For Each a In WScript.Arguments
    args = args & " " & a
Next
bat = fso.GetParentFolderName(WScript.ScriptFullName) & "\run_nightly.bat"
rc = sh.Run("cmd.exe /c """"" & bat & """" & args & """", 0, True)
WScript.Quit rc
