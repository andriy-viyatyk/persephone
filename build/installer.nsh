; ===================================================================
; installer.nsh — Custom NSIS installer options for Persephone
; ===================================================================
;
; Adds a custom page after directory selection with checkboxes:
;   1. Create desktop shortcut                        (checked by default)
;   2. Create Start menu shortcut                     (checked by default)
;   3. "Open with persephone" Explorer context menu   (checked by default)
;   4. Set as default app for text files              (unchecked by default)
;   5. Register as default browser                    (unchecked by default)
;
; Selected options are persisted to the registry so the uninstaller
; (and future upgrades) know exactly what to clean up.
;
; Registry root: HKCU\Software\persephone\Install
; ===================================================================

!include "nsDialogs.nsh"

; --- Variables (installer only — the uninstaller reads from the registry) --
!ifndef BUILD_UNINSTALLER
Var hChkDesktop
Var hChkStartMenu
Var hChkContextMenu
Var hChkTextFiles
Var hChkBrowser
Var OptDesktop
Var OptStartMenu
Var OptContextMenu
Var OptTextFiles
Var OptBrowser
!endif

; ========================================================================
; Helper macros – file association register / unregister
; ========================================================================

!macro _RegisterFileAssoc EXT
    ; Save the current default handler so we can restore it on uninstall.
    ClearErrors
    ReadRegStr $R0 HKCU "Software\Classes\.${EXT}" ""
    ${If} $R0 != "Persephone.Document"
        ; Only save if it wasn't already ours (avoids clobbering the backup).
        WriteRegStr HKCU "Software\persephone\Install\PrevAssoc" ".${EXT}" $R0
    ${EndIf}
    WriteRegStr HKCU "Software\Classes\.${EXT}" "" "Persephone.Document"
!macroend

!macro _UnRegisterFileAssoc EXT
    ; Only touch the extension if we currently own it.
    ReadRegStr $R0 HKCU "Software\Classes\.${EXT}" ""
    ${If} $R0 == "Persephone.Document"
        ClearErrors
        ReadRegStr $R1 HKCU "Software\persephone\Install\PrevAssoc" ".${EXT}"
        ${If} ${Errors}
            DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
        ${ElseIf} $R1 != ""
            WriteRegStr HKCU "Software\Classes\.${EXT}" "" $R1
        ${Else}
            DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
        ${EndIf}
    ${EndIf}
!macroend

; ========================================================================
; customInit — read previously stored selections (upgrade-aware defaults)
; ========================================================================

!macro customInit
    ClearErrors
    ReadRegDWORD $OptDesktop HKCU "Software\persephone\Install" "Desktop"
    ${If} ${Errors}
        StrCpy $OptDesktop ${BST_CHECKED}       ; first install → checked
    ${EndIf}

    ClearErrors
    ReadRegDWORD $OptStartMenu HKCU "Software\persephone\Install" "StartMenu"
    ${If} ${Errors}
        StrCpy $OptStartMenu ${BST_CHECKED}     ; first install → checked
    ${EndIf}

    ClearErrors
    ReadRegDWORD $OptContextMenu HKCU "Software\persephone\Install" "ContextMenu"
    ${If} ${Errors}
        StrCpy $OptContextMenu ${BST_CHECKED}   ; first install → checked
    ${EndIf}

    ClearErrors
    ReadRegDWORD $OptTextFiles HKCU "Software\persephone\Install" "TextFiles"
    ${If} ${Errors}
        StrCpy $OptTextFiles ${BST_UNCHECKED}   ; first install → unchecked
    ${EndIf}

    ClearErrors
    ReadRegDWORD $OptBrowser HKCU "Software\persephone\Install" "Browser"
    ${If} ${Errors}
        StrCpy $OptBrowser ${BST_UNCHECKED}     ; first install → unchecked
    ${EndIf}
!macroend

; ========================================================================
; Custom page — "Additional Options" (after directory selection)
; ========================================================================

!macro customPageAfterChangeDir
    !ifndef BUILD_UNINSTALLER
        Page custom optionsPageCreate optionsPageLeave
    !endif
!macroend

; --- Page create (installer only) ----------------------------------------

!ifndef BUILD_UNINSTALLER
Function optionsPageCreate
    ; Set the page header text (via dialog item IDs — avoids MUI macro dependency).
    GetDlgItem $R8 $HWNDPARENT 1037
    SendMessage $R8 ${WM_SETTEXT} 0 "STR:Additional Options"
    GetDlgItem $R8 $HWNDPARENT 1038
    SendMessage $R8 ${WM_SETTEXT} 0 "STR:Select additional features to configure."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
        Abort
    ${EndIf}

    ; --- Shortcuts section ---
    ${NSD_CreateLabel} 0 0u 100% 10u "Shortcuts:"
    Pop $0

    ${NSD_CreateCheckbox} 10u 13u 95% 12u "Create desktop shortcut"
    Pop $hChkDesktop
    ${If} $OptDesktop == ${BST_CHECKED}
        ${NSD_Check} $hChkDesktop
    ${EndIf}

    ${NSD_CreateCheckbox} 10u 27u 95% 12u "Create Start menu shortcut"
    Pop $hChkStartMenu
    ${If} $OptStartMenu == ${BST_CHECKED}
        ${NSD_Check} $hChkStartMenu
    ${EndIf}

    ; --- System integration section ---
    ${NSD_CreateLabel} 0 47u 100% 10u "System integration:"
    Pop $0

    ${NSD_CreateCheckbox} 10u 60u 95% 12u \
        'Add "Open with persephone" to Explorer context menu'
    Pop $hChkContextMenu
    ${If} $OptContextMenu == ${BST_CHECKED}
        ${NSD_Check} $hChkContextMenu
    ${EndIf}

    ${NSD_CreateCheckbox} 10u 74u 95% 12u \
        "Set as default app for text files"
    Pop $hChkTextFiles
    ${If} $OptTextFiles == ${BST_CHECKED}
        ${NSD_Check} $hChkTextFiles
    ${EndIf}

    ${NSD_CreateLabel} 24u 87u 90% 10u \
        "(.txt, .log, .md, .js, .ts, .jsx, .tsx, .json, .xml, .html, .css, .py, .java, .c, .cpp)"
    Pop $0

    ${NSD_CreateCheckbox} 10u 101u 95% 12u \
        "Register as default browser"
    Pop $hChkBrowser
    ${If} $OptBrowser == ${BST_CHECKED}
        ${NSD_Check} $hChkBrowser
    ${EndIf}

    nsDialogs::Show
FunctionEnd

; --- Page leave (capture checkbox states) --------------------------------

Function optionsPageLeave
    ${NSD_GetState} $hChkDesktop     $OptDesktop
    ${NSD_GetState} $hChkStartMenu   $OptStartMenu
    ${NSD_GetState} $hChkContextMenu $OptContextMenu
    ${NSD_GetState} $hChkTextFiles   $OptTextFiles
    ${NSD_GetState} $hChkBrowser     $OptBrowser
FunctionEnd
!endif ; !ifndef BUILD_UNINSTALLER

; ========================================================================
; customInstall — apply selected options after file installation
; ========================================================================

!macro customInstall
    ; ── Persist selections for uninstaller / future upgrades ──
    WriteRegDWORD HKCU "Software\persephone\Install" "Desktop"     $OptDesktop
    WriteRegDWORD HKCU "Software\persephone\Install" "StartMenu"   $OptStartMenu
    WriteRegDWORD HKCU "Software\persephone\Install" "ContextMenu" $OptContextMenu
    WriteRegDWORD HKCU "Software\persephone\Install" "TextFiles"   $OptTextFiles
    WriteRegDWORD HKCU "Software\persephone\Install" "Browser"     $OptBrowser

    ; ── 1. Desktop shortcut ──
    ${If} $OptDesktop == ${BST_CHECKED}
        CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\persephone-launcher.exe"
    ${Else}
        Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${EndIf}

    ; ── 2. Start menu shortcut ──
    ${If} $OptStartMenu == ${BST_CHECKED}
        CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
        CreateShortCut "$SMPROGRAMS\${MENU_FILENAME}\${SHORTCUT_NAME}.lnk" "$INSTDIR\persephone-launcher.exe"
    ${Else}
        Delete "$SMPROGRAMS\${MENU_FILENAME}\${SHORTCUT_NAME}.lnk"
        RMDir "$SMPROGRAMS\${MENU_FILENAME}"
    ${EndIf}

    ; ── 3. Explorer "Open with" context menu for ALL files ──
    ${If} $OptContextMenu == ${BST_CHECKED}
        WriteRegStr HKCU "Software\Classes\*\shell\persephone" "" "Open with persephone"
        WriteRegStr HKCU "Software\Classes\*\shell\persephone" "Icon" "$INSTDIR\persephone-launcher.exe,0"
        WriteRegStr HKCU "Software\Classes\*\shell\persephone\command" "" '"$INSTDIR\persephone-launcher.exe" "%1"'
    ${Else}
        DeleteRegKey HKCU "Software\Classes\*\shell\persephone"
    ${EndIf}

    ; ── 4. File associations for text/code files ──
    ;   Always create the ProgID (harmless if no extensions point to it).
    WriteRegStr HKCU "Software\Classes\Persephone.Document" "" "Persephone Document"
    WriteRegStr HKCU "Software\Classes\Persephone.Document\DefaultIcon" "" "$INSTDIR\persephone-launcher.exe,0"
    WriteRegStr HKCU "Software\Classes\Persephone.Document\shell\open\command" "" '"$INSTDIR\persephone-launcher.exe" "%1"'

    ${If} $OptTextFiles == ${BST_CHECKED}
        !insertmacro _RegisterFileAssoc "txt"
        !insertmacro _RegisterFileAssoc "log"
        !insertmacro _RegisterFileAssoc "md"
        !insertmacro _RegisterFileAssoc "js"
        !insertmacro _RegisterFileAssoc "ts"
        !insertmacro _RegisterFileAssoc "jsx"
        !insertmacro _RegisterFileAssoc "tsx"
        !insertmacro _RegisterFileAssoc "json"
        !insertmacro _RegisterFileAssoc "xml"
        !insertmacro _RegisterFileAssoc "html"
        !insertmacro _RegisterFileAssoc "css"
        !insertmacro _RegisterFileAssoc "py"
        !insertmacro _RegisterFileAssoc "java"
        !insertmacro _RegisterFileAssoc "c"
        !insertmacro _RegisterFileAssoc "cpp"
    ${Else}
        ; Unchecked (or unchecked during upgrade) — clean up our associations.
        !insertmacro _UnRegisterFileAssoc "txt"
        !insertmacro _UnRegisterFileAssoc "log"
        !insertmacro _UnRegisterFileAssoc "md"
        !insertmacro _UnRegisterFileAssoc "js"
        !insertmacro _UnRegisterFileAssoc "ts"
        !insertmacro _UnRegisterFileAssoc "jsx"
        !insertmacro _UnRegisterFileAssoc "tsx"
        !insertmacro _UnRegisterFileAssoc "json"
        !insertmacro _UnRegisterFileAssoc "xml"
        !insertmacro _UnRegisterFileAssoc "html"
        !insertmacro _UnRegisterFileAssoc "css"
        !insertmacro _UnRegisterFileAssoc "py"
        !insertmacro _UnRegisterFileAssoc "java"
        !insertmacro _UnRegisterFileAssoc "c"
        !insertmacro _UnRegisterFileAssoc "cpp"
    ${EndIf}

    ; ── 5. Browser registration ──
    ${If} $OptBrowser == ${BST_CHECKED}
        ; --- Internet client registration ---
        WriteRegStr HKCU "Software\Clients\StartMenuInternet\persephone" "" "Persephone"
        WriteRegStr HKCU "Software\Clients\StartMenuInternet\persephone\Capabilities" \
            "ApplicationName" "Persephone"
        WriteRegStr HKCU "Software\Clients\StartMenuInternet\persephone\Capabilities" \
            "ApplicationDescription" "Persephone"
        WriteRegStr HKCU "Software\Clients\StartMenuInternet\persephone\Capabilities\URLAssociations" \
            "http" "PersephoneURL"
        WriteRegStr HKCU "Software\Clients\StartMenuInternet\persephone\Capabilities\URLAssociations" \
            "https" "PersephoneURL"
        WriteRegStr HKCU "Software\Clients\StartMenuInternet\persephone\Capabilities\FileAssociations" \
            ".htm" "PersephoneHTM"
        WriteRegStr HKCU "Software\Clients\StartMenuInternet\persephone\Capabilities\FileAssociations" \
            ".html" "PersephoneHTM"
        WriteRegStr HKCU "Software\Clients\StartMenuInternet\persephone\DefaultIcon" "" \
            "$INSTDIR\persephone-launcher.exe,0"
        WriteRegStr HKCU "Software\Clients\StartMenuInternet\persephone\shell\open\command" "" \
            '"$INSTDIR\persephone-launcher.exe"'

        ; --- URL protocol handler ---
        WriteRegStr HKCU "Software\Classes\PersephoneURL" "" "Persephone URL"
        WriteRegStr HKCU "Software\Classes\PersephoneURL" "URL Protocol" ""
        WriteRegStr HKCU "Software\Classes\PersephoneURL\DefaultIcon" "" \
            "$INSTDIR\persephone-launcher.exe,0"
        WriteRegStr HKCU "Software\Classes\PersephoneURL\shell\open\command" "" \
            '"$INSTDIR\persephone-launcher.exe" "%1"'

        ; --- HTML file handler ---
        WriteRegStr HKCU "Software\Classes\PersephoneHTM" "" "Persephone HTML Document"
        WriteRegStr HKCU "Software\Classes\PersephoneHTM\DefaultIcon" "" \
            "$INSTDIR\persephone-launcher.exe,0"
        WriteRegStr HKCU "Software\Classes\PersephoneHTM\shell\open\command" "" \
            '"$INSTDIR\persephone-launcher.exe" "%1"'

        ; --- Registered application (makes it appear in Default Apps) ---
        WriteRegStr HKCU "Software\RegisteredApplications" "persephone" \
            "Software\Clients\StartMenuInternet\persephone\Capabilities"
    ${Else}
        DeleteRegKey HKCU "Software\Clients\StartMenuInternet\persephone"
        DeleteRegKey HKCU "Software\Classes\PersephoneURL"
        DeleteRegKey HKCU "Software\Classes\PersephoneHTM"
        DeleteRegValue HKCU "Software\RegisteredApplications" "persephone"
    ${EndIf}

    ; ── Notify the shell so Explorer picks up changes immediately ──
    System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; ========================================================================
; customUnInstall — remove only the options that were installed
; ========================================================================

!macro customUnInstall
    ; Read what was installed
    ReadRegDWORD $R0 HKCU "Software\persephone\Install" "Desktop"
    ReadRegDWORD $R1 HKCU "Software\persephone\Install" "StartMenu"
    ReadRegDWORD $R2 HKCU "Software\persephone\Install" "ContextMenu"
    ReadRegDWORD $R3 HKCU "Software\persephone\Install" "TextFiles"
    ReadRegDWORD $R4 HKCU "Software\persephone\Install" "Browser"

    ; ── 1. Desktop shortcut ──
    ${If} $R0 == ${BST_CHECKED}
        Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${EndIf}

    ; ── 2. Start menu shortcut ──
    ${If} $R1 == ${BST_CHECKED}
        Delete "$SMPROGRAMS\${MENU_FILENAME}\${SHORTCUT_NAME}.lnk"
        RMDir "$SMPROGRAMS\${MENU_FILENAME}"
    ${EndIf}

    ; ── 3. Context menu ──
    ${If} $R2 == ${BST_CHECKED}
        DeleteRegKey HKCU "Software\Classes\*\shell\persephone"
    ${EndIf}

    ; ── 4. File associations ──
    ${If} $R3 == ${BST_CHECKED}
        !insertmacro _UnRegisterFileAssoc "txt"
        !insertmacro _UnRegisterFileAssoc "log"
        !insertmacro _UnRegisterFileAssoc "md"
        !insertmacro _UnRegisterFileAssoc "js"
        !insertmacro _UnRegisterFileAssoc "ts"
        !insertmacro _UnRegisterFileAssoc "jsx"
        !insertmacro _UnRegisterFileAssoc "tsx"
        !insertmacro _UnRegisterFileAssoc "json"
        !insertmacro _UnRegisterFileAssoc "xml"
        !insertmacro _UnRegisterFileAssoc "html"
        !insertmacro _UnRegisterFileAssoc "css"
        !insertmacro _UnRegisterFileAssoc "py"
        !insertmacro _UnRegisterFileAssoc "java"
        !insertmacro _UnRegisterFileAssoc "c"
        !insertmacro _UnRegisterFileAssoc "cpp"
    ${EndIf}

    ; Always remove the ProgID
    DeleteRegKey HKCU "Software\Classes\Persephone.Document"

    ; ── 5. Browser registration ──
    ${If} $R4 == ${BST_CHECKED}
        DeleteRegKey HKCU "Software\Clients\StartMenuInternet\persephone"
        DeleteRegKey HKCU "Software\Classes\PersephoneURL"
        DeleteRegKey HKCU "Software\Classes\PersephoneHTM"
        DeleteRegValue HKCU "Software\RegisteredApplications" "persephone"
    ${EndIf}

    ; ── Clean up our own registry branch ──
    DeleteRegKey HKCU "Software\persephone\Install"

    ; Notify the shell
    System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
