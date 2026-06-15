; ============================================================================
; Manual NSIS installer for Electron win-unpacked output (MakeNSISW / makensis).
;
; Before compile:
;   1. Run: npm run dist:dir   (creates release\win-unpacked)
;   2. Adjust SOURCE_DIR below if your folder layout differs.
;   3. Open this file in MakeNSISW → Compile (or: makensis.exe make-installer.nsi)
;
; Output (next to this .nsi): AI-Content-Studio-Setup.exe
;
; Requires NSIS with Unicode support for Chinese names (NSIS 3.x Unicode build).
; If "Unicode True" fails to compile, remove that line and set APP_NAME to ASCII.
; ============================================================================

Unicode True
!include "MUI2.nsh"

!define APP_NAME        "AI 内容工作室"
!define APP_EXE         "AI 内容工作室.exe"
!define INSTALL_KEY     "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIContentStudio"
!define PRODUCT_VERSION "1.01"

; Path to electron-builder --win dir output (relative to THIS .nsi file):
!define SOURCE_DIR      "..\release\win-unpacked"

Name "${APP_NAME}"
OutFile "AI-Content-Studio-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\AIContentStudio"
RequestExecutionLevel user

; PE version resource uses four integers (此处与显示的 ProductVersion "1.01" 对应为 1.0.1.0)
VIProductVersion 1.0.1.0
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "LegalCopyright" "local"

!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!insertmacro MUI_PAGE_FINISH

; Use "SimpChinese" here if your NSIS install includes that language pack.
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"

  ; Pack entire unpacked Electron folder (preserve layout).
  File /r "${SOURCE_DIR}\*.*"

  ; Desktop shortcut
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR" 0

  ; Start Menu (optional but handy)
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR" 0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "${INSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${INSTALL_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${INSTALL_KEY}" "Publisher" "local"
  WriteRegStr HKCU "${INSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${INSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${INSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${INSTALL_KEY}" "NoRepair" 1

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "${INSTALL_KEY}"
SectionEnd
