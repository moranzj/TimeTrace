' Activity Tracker - start daemon hidden (no console window)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
nodeExe = "node.exe"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then nodeExe = """C:\Program Files\nodejs\node.exe"""
sh.Run nodeExe & " daemon.mjs", 0, False
