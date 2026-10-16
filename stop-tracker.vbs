' TimeTrace - stop recording, then show a confirmation dialog.
' NOTE: this file must stay pure ASCII. WSH reads .vbs as ANSI (GBK), so UTF-8
' Chinese literals would become mojibake; Chinese text below is assembled from
' Unicode code points with ChrW() instead.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & root & "\stop.ps1""", 0, True

' 时迹已停止。
quit = ChrW(&H65F6) & ChrW(&H8FF9) & ChrW(&H5DF2) & ChrW(&H505C) & ChrW(&H6B62) & ChrW(&H3002)
' 要重新开启：双击桌面「时迹」图标即可
tip = ChrW(&H8981) & ChrW(&H91CD) & ChrW(&H65B0) & ChrW(&H5F00) & ChrW(&H542F) & ChrW(&HFF1A) & ChrW(&H53CC) & ChrW(&H51FB) & ChrW(&H684C) & ChrW(&H9762) & ChrW(&H300C) & ChrW(&H65F6) & ChrW(&H8FF9) & ChrW(&H300D) & ChrW(&H56FE) & ChrW(&H6807) & ChrW(&H5373) & ChrW(&H53EF)
' 时迹
title = ChrW(&H65F6) & ChrW(&H8FF9)

MsgBox quit & vbCrLf & vbCrLf & tip, 64, title
