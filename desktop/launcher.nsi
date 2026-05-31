; Password Launcher for C F Trading ENT POS
; Wraps setup-core.exe with a password gate, then launches the real installer UI

!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Name "C F Trading ENT POS"
OutFile "dist\C F Trading ENT POS-Setup-1.0.0.exe"
Icon "cf-trading-ent.ico"
RequestExecutionLevel admin
ShowInstDetails show

Var pwdDlg
Var pwdCtrl
Var showChk
Var pwdValue

Page custom PasswordPage PasswordPageLeave
Page instfiles

Section "-Install" SecCore
  SetOutPath "$TEMP\CFTradingEntInstall"
  File "dist\internal\setup-core.exe"

  ; ── Install Visual C++ 2015-2022 Redistributable (x64) if missing ──
  ; PHP requires VCRUNTIME140.dll and MSVCP140.dll. If they are absent
  ; (error 0xC0000135) the app will not start on a fresh Windows PC.
  DetailPrint "Checking Visual C++ Runtime..."
  IfFileExists "$SYSDIR\VCRUNTIME140.dll" vcrt_ok vcrt_missing
  vcrt_missing:
    DetailPrint "Installing Microsoft Visual C++ 2015-2022 Redistributable (x64)..."
    File "vc_redist.x64.exe"
    ExecWait '"$TEMP\CFTradingEntInstall\vc_redist.x64.exe" /install /quiet /norestart' $0
    DetailPrint "VC++ Redistributable install exit code: $0"
    Delete "$TEMP\CFTradingEntInstall\vc_redist.x64.exe"
  vcrt_ok:

  DetailPrint "Starting C F Trading ENT POS installation wizard..."

  ; ExecWait exits too early for electron-builder stubs — open the real installer UI
  ExecShell "open" "$TEMP\CFTradingEntInstall\setup-core.exe" "" "SW_SHOW"

  Sleep 2000

  MessageBox MB_OK|MB_ICONINFORMATION \
    "The installation wizard should now be open in a separate window.$\n$\nComplete every step there (folder, shortcuts, Finish).$\n$\nIf you do not see it, check the taskbar.$\n$\nClick OK here only after that installer has finished." \
    IDOK done
  done:

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
      SendMessage $HWNDPARENT 0x408 -1 0
  ${EndIf}
FunctionEnd
