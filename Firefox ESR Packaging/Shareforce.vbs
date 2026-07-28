Option Explicit
On error resume next

Dim fso, objFSO, objShell, strUserAppData, strScriptDirectory, strUserDomain
Set objShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set objFSO = CreateObject("Scripting.FileSystemObject")

strUserDomain = objShell.ExpandEnvironmentStrings( "%USERDOMAIN%" )
strScriptDirectory = Left(Wscript.ScriptFullName,(Len(Wscript.ScriptFullName))-(Len(Wscript.ScriptName)))
strUserAppData = objShell.ExpandEnvironmentStrings("%APPDATA%")

fso.CopyFile strScriptDirectory & "mimeTypes.rdf", strScriptDirectory & "browser\defaults\Profile\", true
	
if ucase(strUserDomain) <> "STORESVC" AND objFSO.FolderExists(strUserAppData & "\Mozilla") then 
	objFSO.DeleteFolder strUserAppData & "\Mozilla", true
end if
