; ===================================================================
; installer.nsh — Custom NSIS installer options for Persephone
; ===================================================================
;
; Adds a custom page after directory selection with checkboxes:
;   1. Create desktop shortcut                        (checked by default)
;   2. Create Start menu shortcut                     (checked by default)
;   3. "Open with persephone" for files               (checked by default)
;   4. "Open with persephone" for folders             (checked by default)
;   5. Register as default browser                    (unchecked by default)
;
; Selected options are persisted to the registry so the uninstaller
; (and future upgrades) know exactly what to clean up.
;
; Registry root: HKCU\Software\persephone\Install
;
; --- Retired option: "Set as default app for text files" ------------
; Persephone claims no file extensions any more. It opens essentially
; anything — and what it cannot open natively, an installable board or a
; user-built viewer can — so owning a fixed list of extensions was both
; arbitrary and a land-grab on handlers the user did not ask us to take.
;
; The registration code is deliberately KEPT, minus its checkbox: $OptTextFiles
; is now forced unchecked, which drives customInstall down the ${Else} branch
; and RELEASES the associations (restoring each extension's previous handler
; from PrevAssoc). Deleting the macros instead would strand anyone who ticked
; the old box — permanently associated, with no installer path back.
; ===================================================================

!include "nsDialogs.nsh"

; Language declarations are expanded from customHeader after electron-builder's
; addLangs macro has inserted the matching MUI_LANGUAGE definitions.
!macro customHeader
    LangString InstallerAdditionalOptions ${LANG_ENGLISH} "Additional Options"
    LangString InstallerAdditionalOptions ${LANG_UKRAINIAN} "Додаткові параметри"
    LangString InstallerAdditionalOptions ${LANG_POLISH} "Dodatkowe opcje"
    LangString InstallerAdditionalOptions ${LANG_LITHUANIAN} "Papildomos parinktys"
    LangString InstallerAdditionalOptions ${LANG_LATVIAN} "Papildu opcijas"
    LangString InstallerAdditionalOptions ${LANG_ESTONIAN} "Lisavalikud"
    LangString InstallerAdditionalOptions ${LANG_BELARUSIAN} "Дадатковыя параметры"
    LangString InstallerAdditionalOptions ${LANG_ROMANIAN} "Opțiuni suplimentare"
    LangString InstallerAdditionalOptions ${LANG_SLOVAK} "Ďalšie možnosti"
    LangString InstallerAdditionalOptions ${LANG_HUNGARIAN} "További beállítások"
    LangString InstallerAdditionalOptions ${LANG_GERMAN} "Zusätzliche Optionen"
    LangString InstallerAdditionalOptions ${LANG_FRENCH} "Options supplémentaires"
    LangString InstallerAdditionalOptions ${LANG_SPANISH} "Opciones adicionales"
    LangString InstallerAdditionalOptions ${LANG_PORTUGUESEBR} "Opções adicionais"
    LangString InstallerAdditionalOptions ${LANG_ITALIAN} "Opzioni aggiuntive"
    LangString InstallerAdditionalOptions ${LANG_SIMPCHINESE} "其他选项"
    LangString InstallerAdditionalOptions ${LANG_JAPANESE} "追加オプション"
    LangString InstallerAdditionalOptions ${LANG_KOREAN} "추가 옵션"

    LangString InstallerOptionsSubtitle ${LANG_ENGLISH} "Select additional features to configure."
    LangString InstallerOptionsSubtitle ${LANG_UKRAINIAN} "Виберіть додаткові функції для налаштування."
    LangString InstallerOptionsSubtitle ${LANG_POLISH} "Wybierz dodatkowe funkcje do skonfigurowania."
    LangString InstallerOptionsSubtitle ${LANG_LITHUANIAN} "Pasirinkite papildomas funkcijas, kurias norite konfigūruoti."
    LangString InstallerOptionsSubtitle ${LANG_LATVIAN} "Izvēlieties papildu konfigurējamās funkcijas."
    LangString InstallerOptionsSubtitle ${LANG_ESTONIAN} "Valige lisafunktsioonid, mida seadistada."
    LangString InstallerOptionsSubtitle ${LANG_BELARUSIAN} "Выберыце дадатковыя функцыі для наладжвання."
    LangString InstallerOptionsSubtitle ${LANG_ROMANIAN} "Selectați funcțiile suplimentare de configurat."
    LangString InstallerOptionsSubtitle ${LANG_SLOVAK} "Vyberte ďalšie funkcie na konfiguráciu."
    LangString InstallerOptionsSubtitle ${LANG_HUNGARIAN} "Válassza ki a beállítani kívánt további funkciókat."
    LangString InstallerOptionsSubtitle ${LANG_GERMAN} "Wählen Sie zusätzliche Funktionen zur Konfiguration aus."
    LangString InstallerOptionsSubtitle ${LANG_FRENCH} "Sélectionnez les fonctionnalités supplémentaires à configurer."
    LangString InstallerOptionsSubtitle ${LANG_SPANISH} "Seleccione las funciones adicionales que desea configurar."
    LangString InstallerOptionsSubtitle ${LANG_PORTUGUESEBR} "Selecione os recursos adicionais que deseja configurar."
    LangString InstallerOptionsSubtitle ${LANG_ITALIAN} "Seleziona le funzionalità aggiuntive da configurare."
    LangString InstallerOptionsSubtitle ${LANG_SIMPCHINESE} "选择要配置的其他功能。"
    LangString InstallerOptionsSubtitle ${LANG_JAPANESE} "設定する追加機能を選択してください。"
    LangString InstallerOptionsSubtitle ${LANG_KOREAN} "구성할 추가 기능을 선택하세요."

    LangString InstallerShortcuts ${LANG_ENGLISH} "Shortcuts:"
    LangString InstallerShortcuts ${LANG_UKRAINIAN} "Ярлики:"
    LangString InstallerShortcuts ${LANG_POLISH} "Skróty:"
    LangString InstallerShortcuts ${LANG_LITHUANIAN} "Nuorodos:"
    LangString InstallerShortcuts ${LANG_LATVIAN} "Īsceļi:"
    LangString InstallerShortcuts ${LANG_ESTONIAN} "Otseteed:"
    LangString InstallerShortcuts ${LANG_BELARUSIAN} "Ярлыкі:"
    LangString InstallerShortcuts ${LANG_ROMANIAN} "Comenzi rapide:"
    LangString InstallerShortcuts ${LANG_SLOVAK} "Skratky:"
    LangString InstallerShortcuts ${LANG_HUNGARIAN} "Parancsikonok:"
    LangString InstallerShortcuts ${LANG_GERMAN} "Verknüpfungen:"
    LangString InstallerShortcuts ${LANG_FRENCH} "Raccourcis :"
    LangString InstallerShortcuts ${LANG_SPANISH} "Accesos directos:"
    LangString InstallerShortcuts ${LANG_PORTUGUESEBR} "Atalhos:"
    LangString InstallerShortcuts ${LANG_ITALIAN} "Collegamenti:"
    LangString InstallerShortcuts ${LANG_SIMPCHINESE} "快捷方式："
    LangString InstallerShortcuts ${LANG_JAPANESE} "ショートカット："
    LangString InstallerShortcuts ${LANG_KOREAN} "바로 가기:"

    LangString InstallerDesktopShortcut ${LANG_ENGLISH} "Create desktop shortcut"
    LangString InstallerDesktopShortcut ${LANG_UKRAINIAN} "Створити ярлик на робочому столі"
    LangString InstallerDesktopShortcut ${LANG_POLISH} "Utwórz skrót na pulpicie"
    LangString InstallerDesktopShortcut ${LANG_LITHUANIAN} "Sukurti darbalaukio nuorodą"
    LangString InstallerDesktopShortcut ${LANG_LATVIAN} "Izveidot darbvirsmas saīsni"
    LangString InstallerDesktopShortcut ${LANG_ESTONIAN} "Loo töölaua otsetee"
    LangString InstallerDesktopShortcut ${LANG_BELARUSIAN} "Стварыць ярлык на працоўным стале"
    LangString InstallerDesktopShortcut ${LANG_ROMANIAN} "Creați o comandă rapidă pe desktop"
    LangString InstallerDesktopShortcut ${LANG_SLOVAK} "Vytvoriť odkaz na pracovnej ploche"
    LangString InstallerDesktopShortcut ${LANG_HUNGARIAN} "Asztali parancsikon létrehozása"
    LangString InstallerDesktopShortcut ${LANG_GERMAN} "Desktop-Verknüpfung erstellen"
    LangString InstallerDesktopShortcut ${LANG_FRENCH} "Créer un raccourci sur le bureau"
    LangString InstallerDesktopShortcut ${LANG_SPANISH} "Crear acceso directo en el escritorio"
    LangString InstallerDesktopShortcut ${LANG_PORTUGUESEBR} "Criar atalho na área de trabalho"
    LangString InstallerDesktopShortcut ${LANG_ITALIAN} "Crea un collegamento sul desktop"
    LangString InstallerDesktopShortcut ${LANG_SIMPCHINESE} "创建桌面快捷方式"
    LangString InstallerDesktopShortcut ${LANG_JAPANESE} "デスクトップにショートカットを作成"
    LangString InstallerDesktopShortcut ${LANG_KOREAN} "바탕 화면 바로 가기 만들기"

    LangString InstallerStartMenuShortcut ${LANG_ENGLISH} "Create Start menu shortcut"
    LangString InstallerStartMenuShortcut ${LANG_UKRAINIAN} "Створити ярлик у меню «Пуск»"
    LangString InstallerStartMenuShortcut ${LANG_POLISH} "Utwórz skrót w menu Start"
    LangString InstallerStartMenuShortcut ${LANG_LITHUANIAN} "Sukurti nuorodą meniu Pradėti"
    LangString InstallerStartMenuShortcut ${LANG_LATVIAN} "Izveidot saīsni izvēlnē Sākt"
    LangString InstallerStartMenuShortcut ${LANG_ESTONIAN} "Loo otsetee menüüsse Start"
    LangString InstallerStartMenuShortcut ${LANG_BELARUSIAN} "Стварыць ярлык у меню «Пуск»"
    LangString InstallerStartMenuShortcut ${LANG_ROMANIAN} "Creați o comandă rapidă în meniul Start"
    LangString InstallerStartMenuShortcut ${LANG_SLOVAK} "Vytvoriť odkaz v ponuke Štart"
    LangString InstallerStartMenuShortcut ${LANG_HUNGARIAN} "Parancsikon létrehozása a Start menüben"
    LangString InstallerStartMenuShortcut ${LANG_GERMAN} "Verknüpfung im Startmenü erstellen"
    LangString InstallerStartMenuShortcut ${LANG_FRENCH} "Créer un raccourci dans le menu Démarrer"
    LangString InstallerStartMenuShortcut ${LANG_SPANISH} "Crear acceso directo en el menú Inicio"
    LangString InstallerStartMenuShortcut ${LANG_PORTUGUESEBR} "Criar atalho no menu Iniciar"
    LangString InstallerStartMenuShortcut ${LANG_ITALIAN} "Crea un collegamento nel menu Start"
    LangString InstallerStartMenuShortcut ${LANG_SIMPCHINESE} "在开始菜单中创建快捷方式"
    LangString InstallerStartMenuShortcut ${LANG_JAPANESE} "スタートメニューにショートカットを作成"
    LangString InstallerStartMenuShortcut ${LANG_KOREAN} "시작 메뉴 바로 가기 만들기"

    LangString InstallerSystemIntegration ${LANG_ENGLISH} "System integration:"
    LangString InstallerSystemIntegration ${LANG_UKRAINIAN} "Інтеграція із системою:"
    LangString InstallerSystemIntegration ${LANG_POLISH} "Integracja z systemem:"
    LangString InstallerSystemIntegration ${LANG_LITHUANIAN} "Integracija su sistema:"
    LangString InstallerSystemIntegration ${LANG_LATVIAN} "Sistēmas integrācija:"
    LangString InstallerSystemIntegration ${LANG_ESTONIAN} "Süsteemi lõimimine:"
    LangString InstallerSystemIntegration ${LANG_BELARUSIAN} "Інтэграцыя з сістэмай:"
    LangString InstallerSystemIntegration ${LANG_ROMANIAN} "Integrare cu sistemul:"
    LangString InstallerSystemIntegration ${LANG_SLOVAK} "Integrácia so systémom:"
    LangString InstallerSystemIntegration ${LANG_HUNGARIAN} "Rendszerintegráció:"
    LangString InstallerSystemIntegration ${LANG_GERMAN} "Systemintegration:"
    LangString InstallerSystemIntegration ${LANG_FRENCH} "Intégration système :"
    LangString InstallerSystemIntegration ${LANG_SPANISH} "Integración con el sistema:"
    LangString InstallerSystemIntegration ${LANG_PORTUGUESEBR} "Integração com o sistema:"
    LangString InstallerSystemIntegration ${LANG_ITALIAN} "Integrazione di sistema:"
    LangString InstallerSystemIntegration ${LANG_SIMPCHINESE} "系统集成："
    LangString InstallerSystemIntegration ${LANG_JAPANESE} "システム統合："
    LangString InstallerSystemIntegration ${LANG_KOREAN} "시스템 통합:"

    LangString InstallerOpenWithFiles ${LANG_ENGLISH} "Add ‘Open with persephone’ for files to Explorer context menu"
    LangString InstallerOpenWithFiles ${LANG_UKRAINIAN} "Додати «Відкрити за допомогою persephone» до контекстного меню файлів у Провіднику"
    LangString InstallerOpenWithFiles ${LANG_POLISH} "Dodaj „Otwórz za pomocą persephone” do menu kontekstowego plików w Eksploratorze"
    LangString InstallerOpenWithFiles ${LANG_LITHUANIAN} "Įtraukti „Atidaryti naudojant persephone” į failų kontekstinį meniu „Explorer”"
    LangString InstallerOpenWithFiles ${LANG_LATVIAN} "Pievienot “Atvērt ar persephone” failu konteksta izvēlnei programmā Explorer"
    LangString InstallerOpenWithFiles ${LANG_ESTONIAN} "Lisa failide Exploreri kontekstimenüüsse „Ava rakendusega persephone”"
    LangString InstallerOpenWithFiles ${LANG_BELARUSIAN} "Дадаць «Адкрыць з дапамогай persephone» у кантэкстнае меню файлаў у Правадыру"
    LangString InstallerOpenWithFiles ${LANG_ROMANIAN} "Adăugați „Deschideți cu persephone” în meniul contextual al fișierelor din Explorer"
    LangString InstallerOpenWithFiles ${LANG_SLOVAK} "Pridať „Otvoriť pomocou persephone” do kontextovej ponuky súborov v Prieskumníkovi"
    LangString InstallerOpenWithFiles ${LANG_HUNGARIAN} "„Megnyitás persephone-nal” hozzáadása a fájlok Intéző helyi menüjéhez"
    LangString InstallerOpenWithFiles ${LANG_GERMAN} "„Mit persephone öffnen” zum Explorer-Kontextmenü für Dateien hinzufügen"
    LangString InstallerOpenWithFiles ${LANG_FRENCH} "Ajouter « Ouvrir avec persephone » au menu contextuel des fichiers de l’Explorateur"
    LangString InstallerOpenWithFiles ${LANG_SPANISH} "Añadir «Abrir con persephone» al menú contextual de archivos del Explorador"
    LangString InstallerOpenWithFiles ${LANG_PORTUGUESEBR} "Adicionar “Abrir com persephone” ao menu de contexto de arquivos do Explorador"
    LangString InstallerOpenWithFiles ${LANG_ITALIAN} "Aggiungi “Apri con persephone” al menu contestuale dei file di Esplora file"
    LangString InstallerOpenWithFiles ${LANG_SIMPCHINESE} "在文件资源管理器的文件上下文菜单中添加“使用 persephone 打开”"
    LangString InstallerOpenWithFiles ${LANG_JAPANESE} "エクスプローラーのファイルメニューに「persephone で開く」を追加"
    LangString InstallerOpenWithFiles ${LANG_KOREAN} "파일 탐색기 파일 메뉴에 “persephone으로 열기” 추가"

    LangString InstallerOpenWithFolders ${LANG_ENGLISH} "Add ‘Open with persephone’ for folders to Explorer context menu"
    LangString InstallerOpenWithFolders ${LANG_UKRAINIAN} "Додати «Відкрити за допомогою persephone» до контекстного меню папок у Провіднику"
    LangString InstallerOpenWithFolders ${LANG_POLISH} "Dodaj „Otwórz za pomocą persephone” do menu kontekstowego folderów w Eksploratorze"
    LangString InstallerOpenWithFolders ${LANG_LITHUANIAN} "Įtraukti „Atidaryti naudojant persephone” į aplankų kontekstinį meniu „Explorer”"
    LangString InstallerOpenWithFolders ${LANG_LATVIAN} "Pievienot “Atvērt ar persephone” mapju konteksta izvēlnei programmā Explorer"
    LangString InstallerOpenWithFolders ${LANG_ESTONIAN} "Lisa kaustade Exploreri kontekstimenüüsse „Ava rakendusega persephone”"
    LangString InstallerOpenWithFolders ${LANG_BELARUSIAN} "Дадаць «Адкрыць з дапамогай persephone» у кантэкстнае меню папак у Правадыру"
    LangString InstallerOpenWithFolders ${LANG_ROMANIAN} "Adăugați „Deschideți cu persephone” în meniul contextual al folderelor din Explorer"
    LangString InstallerOpenWithFolders ${LANG_SLOVAK} "Pridať „Otvoriť pomocou persephone” do kontextovej ponuky priečinkov v Prieskumníkovi"
    LangString InstallerOpenWithFolders ${LANG_HUNGARIAN} "„Megnyitás persephone-nal” hozzáadása a mappák Intéző helyi menüjéhez"
    LangString InstallerOpenWithFolders ${LANG_GERMAN} "„Mit persephone öffnen” zum Explorer-Kontextmenü für Ordner hinzufügen"
    LangString InstallerOpenWithFolders ${LANG_FRENCH} "Ajouter « Ouvrir avec persephone » au menu contextuel des dossiers de l’Explorateur"
    LangString InstallerOpenWithFolders ${LANG_SPANISH} "Añadir «Abrir con persephone» al menú contextual de carpetas del Explorador"
    LangString InstallerOpenWithFolders ${LANG_PORTUGUESEBR} "Adicionar “Abrir com persephone” ao menu de contexto de pastas do Explorador"
    LangString InstallerOpenWithFolders ${LANG_ITALIAN} "Aggiungi “Apri con persephone” al menu contestuale delle cartelle di Esplora file"
    LangString InstallerOpenWithFolders ${LANG_SIMPCHINESE} "在文件资源管理器的文件夹上下文菜单中添加“使用 persephone 打开”"
    LangString InstallerOpenWithFolders ${LANG_JAPANESE} "エクスプローラーのフォルダーメニューに「persephone で開く」を追加"
    LangString InstallerOpenWithFolders ${LANG_KOREAN} "파일 탐색기 폴더 메뉴에 “persephone으로 열기” 추가"

    LangString InstallerDefaultBrowser ${LANG_ENGLISH} "Register as default browser"
    LangString InstallerDefaultBrowser ${LANG_UKRAINIAN} "Зареєструвати Persephone як браузер"
    LangString InstallerDefaultBrowser ${LANG_POLISH} "Zarejestruj Persephone jako przeglądarkę"
    LangString InstallerDefaultBrowser ${LANG_LITHUANIAN} "Užregistruoti Persephone kaip naršyklę"
    LangString InstallerDefaultBrowser ${LANG_LATVIAN} "Reģistrēt Persephone kā pārlūku"
    LangString InstallerDefaultBrowser ${LANG_ESTONIAN} "Registreeri Persephone brauserina"
    LangString InstallerDefaultBrowser ${LANG_BELARUSIAN} "Зарэгістраваць Persephone як браўзер"
    LangString InstallerDefaultBrowser ${LANG_ROMANIAN} "Înregistrați Persephone ca browser"
    LangString InstallerDefaultBrowser ${LANG_SLOVAK} "Zaregistrovať Persephone ako prehliadač"
    LangString InstallerDefaultBrowser ${LANG_HUNGARIAN} "A Persephone regisztrálása böngészőként"
    LangString InstallerDefaultBrowser ${LANG_GERMAN} "Persephone als Browser registrieren"
    LangString InstallerDefaultBrowser ${LANG_FRENCH} "Enregistrer Persephone comme navigateur"
    LangString InstallerDefaultBrowser ${LANG_SPANISH} "Registrar Persephone como navegador"
    LangString InstallerDefaultBrowser ${LANG_PORTUGUESEBR} "Registrar o Persephone como navegador"
    LangString InstallerDefaultBrowser ${LANG_ITALIAN} "Registra Persephone come browser"
    LangString InstallerDefaultBrowser ${LANG_SIMPCHINESE} "将 Persephone 注册为浏览器"
    LangString InstallerDefaultBrowser ${LANG_JAPANESE} "Persephone をブラウザーとして登録"
    LangString InstallerDefaultBrowser ${LANG_KOREAN} "Persephone을 브라우저로 등록"
!macroend

; --- Variables (installer only — the uninstaller reads from the registry) --
!ifndef BUILD_UNINSTALLER
Var hChkDesktop
Var hChkStartMenu
Var hChkContextMenu
Var hChkFolderMenu
Var hChkBrowser
Var OptDesktop
Var OptStartMenu
Var OptContextMenu
Var OptFolderMenu
Var OptTextFiles    ; no checkbox — always unchecked, see the retired-option note above
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
    ReadRegDWORD $OptFolderMenu HKCU "Software\persephone\Install" "FolderMenu"
    ${If} ${Errors}
        StrCpy $OptFolderMenu ${BST_CHECKED}    ; first install → checked
    ${EndIf}

    ; Text-file associations are retired — never carried over from a previous
    ; install, so an upgrade always takes the release path in customInstall.
    StrCpy $OptTextFiles ${BST_UNCHECKED}

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
    SendMessage $R8 ${WM_SETTEXT} 0 "STR:$(InstallerAdditionalOptions)"
    GetDlgItem $R8 $HWNDPARENT 1038
    SendMessage $R8 ${WM_SETTEXT} 0 "STR:$(InstallerOptionsSubtitle)"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
        Abort
    ${EndIf}

    ; --- Shortcuts section ---
    ${NSD_CreateLabel} 0 0u 100% 10u "$(InstallerShortcuts)"
    Pop $0

    ${NSD_CreateCheckbox} 10u 13u 95% 12u "$(InstallerDesktopShortcut)"
    Pop $hChkDesktop
    ${If} $OptDesktop == ${BST_CHECKED}
        ${NSD_Check} $hChkDesktop
    ${EndIf}

    ${NSD_CreateCheckbox} 10u 27u 95% 12u "$(InstallerStartMenuShortcut)"
    Pop $hChkStartMenu
    ${If} $OptStartMenu == ${BST_CHECKED}
        ${NSD_Check} $hChkStartMenu
    ${EndIf}

    ; --- System integration section ---
    ${NSD_CreateLabel} 0 47u 100% 10u "$(InstallerSystemIntegration)"
    Pop $0

    ${NSD_CreateCheckbox} 10u 60u 95% 12u \
        "$(InstallerOpenWithFiles)"
    Pop $hChkContextMenu
    ${If} $OptContextMenu == ${BST_CHECKED}
        ${NSD_Check} $hChkContextMenu
    ${EndIf}

    ${NSD_CreateCheckbox} 10u 74u 95% 12u \
        "$(InstallerOpenWithFolders)"
    Pop $hChkFolderMenu
    ${If} $OptFolderMenu == ${BST_CHECKED}
        ${NSD_Check} $hChkFolderMenu
    ${EndIf}

    ${NSD_CreateCheckbox} 10u 88u 95% 12u \
        "$(InstallerDefaultBrowser)"
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
    ${NSD_GetState} $hChkFolderMenu  $OptFolderMenu
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
    WriteRegDWORD HKCU "Software\persephone\Install" "FolderMenu"  $OptFolderMenu
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

    ; ── 3b. Explorer "Open with" context menu for FOLDERS ──
    ;   `*` matches files only — folders need their own keys, and there are two:
    ;   `Directory` is right-click ON a folder (%1 = that folder), while
    ;   `Directory\Background` is right-click on empty space INSIDE a folder
    ;   (%V = the folder being viewed; %1 is empty there). Registering only the
    ;   first is the difference between the entry appearing where users expect
    ;   it and appearing half the time.
    ${If} $OptFolderMenu == ${BST_CHECKED}
        WriteRegStr HKCU "Software\Classes\Directory\shell\persephone" "" "Open with persephone"
        WriteRegStr HKCU "Software\Classes\Directory\shell\persephone" "Icon" "$INSTDIR\persephone-launcher.exe,0"
        WriteRegStr HKCU "Software\Classes\Directory\shell\persephone\command" "" '"$INSTDIR\persephone-launcher.exe" "%1"'

        WriteRegStr HKCU "Software\Classes\Directory\Background\shell\persephone" "" "Open with persephone"
        WriteRegStr HKCU "Software\Classes\Directory\Background\shell\persephone" "Icon" "$INSTDIR\persephone-launcher.exe,0"
        WriteRegStr HKCU "Software\Classes\Directory\Background\shell\persephone\command" "" '"$INSTDIR\persephone-launcher.exe" "%V"'
    ${Else}
        DeleteRegKey HKCU "Software\Classes\Directory\shell\persephone"
        DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\persephone"
    ${EndIf}

    ; ── 4. File associations for text/code files (RETIRED — release only) ──
    ;   The ProgID stays: the context-menu entries above do not need it, but
    ;   leaving it lets Windows' "Open with" list keep showing Persephone with
    ;   a proper name and icon instead of a bare exe path.
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
    ; Read what was installed.
    ;
    ; ORDER MATTERS BELOW: _UnRegisterFileAssoc reuses $R0 and $R1 as scratch,
    ; so every ${If} that tests $R0/$R1 must run BEFORE the $R3 branch that
    ; invokes it. It does today, and $R5 is never touched by the macro — but
    ; moving a cleanup block past the TextFiles loop would silently turn this
    ; into a real clobber, with no error, just skipped cleanup.
    ReadRegDWORD $R0 HKCU "Software\persephone\Install" "Desktop"
    ReadRegDWORD $R1 HKCU "Software\persephone\Install" "StartMenu"
    ReadRegDWORD $R2 HKCU "Software\persephone\Install" "ContextMenu"
    ReadRegDWORD $R3 HKCU "Software\persephone\Install" "TextFiles"
    ReadRegDWORD $R4 HKCU "Software\persephone\Install" "Browser"
    ReadRegDWORD $R5 HKCU "Software\persephone\Install" "FolderMenu"

    ; ── 1. Desktop shortcut ──
    ${If} $R0 == ${BST_CHECKED}
        Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${EndIf}

    ; ── 2. Start menu shortcut ──
    ${If} $R1 == ${BST_CHECKED}
        Delete "$SMPROGRAMS\${MENU_FILENAME}\${SHORTCUT_NAME}.lnk"
        RMDir "$SMPROGRAMS\${MENU_FILENAME}"
    ${EndIf}

    ; ── 3. Context menu (files) ──
    ${If} $R2 == ${BST_CHECKED}
        DeleteRegKey HKCU "Software\Classes\*\shell\persephone"
    ${EndIf}

    ; ── 3b. Context menu (folders) ──
    ${If} $R5 == ${BST_CHECKED}
        DeleteRegKey HKCU "Software\Classes\Directory\shell\persephone"
        DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\persephone"
    ${EndIf}

    ; ── 4. File associations ──
    ;   Only reachable for installs predating the retirement of that option —
    ;   any upgrade since will already have released them.
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
