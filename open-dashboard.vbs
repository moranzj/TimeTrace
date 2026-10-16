' Activity Tracker - open dashboard (starts daemon/panel if needed, then opens browser)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root

nodeExe = "node.exe"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then nodeExe = """C:\Program Files\nodejs\node.exe"""
sh.Run nodeExe & " daemon.mjs", 0, False

' read dashboard port from config.json (default 8377)
port = 8377
On Error Resume Next
Set f = fso.OpenTextFile(root & "\config.json", 1)
txt = f.ReadAll
f.Close
i = InStr(txt, """port""")
If i > 0 Then
  j = InStr(i, txt, ":")
  k1 = InStr(j, txt, ",")
  k2 = InStr(j, txt, "}")
  k = k1
  If k2 > 0 And (k1 = 0 Or k2 < k1) Then k = k2
  If k > 0 And j > 0 Then
    num = Trim(Mid(txt, j + 1, k - j - 1))
    If IsNumeric(num) Then port = CLng(num)
  End If
End If
On Error GoTo 0

WScript.Sleep 2500
sh.Run "http://127.0.0.1:" & port & "/", 1, False
