; This file stays ASCII: NSIS reads it as the system code page unless it carries
; a byte order mark, so anything else risks garbling at compile time.
;
; Windows 7, 8 and 8.1 cannot run this app. Every screen is drawn by the
; Microsoft Edge WebView2 runtime, and WebView2 stopped supporting those versions
; in January 2024. The Rust standard library and Tailwind rule them out as well.
; Installing regardless leaves a shortcut that dies on launch with nothing to
; explain why, so the installer says what is wrong and stops.
;
; Build 17134 is Windows 10 version 1803, the oldest release WebView2 supports.
; Build numbers only ever climb (7601 on Windows 7, 9600 on 8.1, 22000 and up on
; Windows 11), so one comparison covers every version.
!define STAYINSURED_MIN_BUILD 17134

; Read the build from the registry rather than asking NSIS for the OS version:
; the compatibility shim reports 6.2 to installers whose manifest does not name
; Windows 10, which would turn away the machines the app runs on best.
Function StayInsuredRequireWindows10
  ; The install section runs this mid-flight, so leave the registers as found.
  Push $0
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"

  ; A registry that cannot be read is not evidence of an old Windows, so let it
  ; through. A guess that blocks a supported machine is worse than no guess.
  ${If} $0 == ""
    Pop $0
    Return
  ${EndIf}

  ${If} $0 < ${STAYINSURED_MIN_BUILD}
    ; A silent install has nobody to read a dialog and would hang on one.
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "StayInsured needs Windows 10 version 1803 or newer.$\n$\nThis computer reports Windows build $0. The app draws its screens with the Microsoft Edge WebView2 runtime, which stopped supporting Windows 7, 8 and 8.1 in January 2024, so it cannot run here.$\n$\nNothing has been installed or changed."
    ${EndIf}
    SetErrorLevel 1
    Quit
  ${EndIf}

  Pop $0
FunctionEnd

; .onGUIInit refuses before the wizard shows a single page, which is the least
; work to waste. It never runs for a silent install, so the install section
; checks again below.
!define MUI_CUSTOMFUNCTION_GUIINIT StayInsuredRequireWindows10

!macro NSIS_HOOK_PREINSTALL
  Call StayInsuredRequireWindows10
!macroend
