; Password Launcher for C F Trading ENT POS
; This wraps the real installer with password protection

!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Name "C F Trading ENT POS"
OutFile "dist\C F Trading ENT POS-Setup-1.0.0.exe"
Icon "cf-trading-ent.ico"
RequestExecutionLevel admin
ShowInstDetails nevershow

Var pwdDlg
Var pwdCtrl
Var showChk
Var pwdValue

Page custom PasswordPage PasswordPageLeave
Page instfiles

Section
  ; Extract and run the real NSIS installer (built as setup-core.exe)
  SetOutPath "$TEMP\CFTradingEntInstall"
  File "dist\internal\setup-core.exe"
  ExecWait '"$TEMP\CFTradingEntInstall\setup-core.exe" /CURRENTUSER'
  Delete "$TEMP\CFTradingEntInstall\setup-core.exe"
  RMDir "$TEMP\CFTradingEntInstall"
SectionEnd

Function PasswordPage
  nsDialogs::Create 1018
  Pop $pwdDlg
  
  ${NSD_CreateLabel} 0 0 100% 40u "C F Trading ENT POS$\n$\nThis is licensed software. Enter the installation password provided by your vendor to continue."
  Pop $0
  
  ${NSD_CreateLabel} 0 50u 100% 12u "Installation Password:"
  Pop $0
  
  ${NSD_CreatePassword} 0 65u 75% 14u ""
  Pop $pwdCtrl
  
  ${NSD_CreateCheckbox} 77% 65u 23% 14u "Show password"
  Pop $showChk
  ${NSD_OnClick} $showChk TogglePassword
  
  nsDialogs::Show
FunctionEnd

Function TogglePassword
  Pop $0
  ${NSD_GetText} $pwdCtrl $pwdValue
  ${NSD_GetState} $showChk $1
  ${If} $1 == ${BST_CHECKED}
    SendMessage $pwdCtrl ${EM_SETPASSWORDCHAR} 0 0
  ${Else}
    SendMessage $pwdCtrl ${EM_SETPASSWORDCHAR} 42 0
  ${EndIf}
  SendMessage $pwdCtrl ${WM_SETTEXT} 0 "STR:$pwdValue"
FunctionEnd

Function PasswordPageLeave
  ${NSD_GetText} $pwdCtrl $pwdValue
  
  ${If} $pwdValue != "tHeAnGrYmAn@#$$2910"
    MessageBox MB_RETRYCANCEL|MB_ICONSTOP \
      "Incorrect password.$\n$\nPlease contact your software vendor for the correct password." \
      IDRETRY retry IDCANCEL cancel
    cancel:
      Quit
    retry:
      ; Go back to password page
      SendMessage $HWNDPARENT 0x408 -1 0
  ${EndIf}
FunctionEnd
