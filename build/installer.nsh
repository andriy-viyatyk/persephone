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
    LangString InstallerAdditionalOptions ${LANG_SPANISHINTERNATIONAL} "Opciones adicionales"
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
    LangString InstallerOptionsSubtitle ${LANG_SPANISHINTERNATIONAL} "Seleccione las funciones adicionales que desea configurar."
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
    LangString InstallerShortcuts ${LANG_SPANISHINTERNATIONAL} "Accesos directos:"
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
    LangString InstallerDesktopShortcut ${LANG_SPANISHINTERNATIONAL} "Crear acceso directo en el escritorio"
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
    LangString InstallerStartMenuShortcut ${LANG_SPANISHINTERNATIONAL} "Crear acceso directo en el menú Inicio"
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
    LangString InstallerSystemIntegration ${LANG_SPANISHINTERNATIONAL} "Integración con el sistema:"
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
    LangString InstallerOpenWithFiles ${LANG_SPANISHINTERNATIONAL} "Añadir «Abrir con persephone» al menú contextual de archivos del Explorador"
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
    LangString InstallerOpenWithFolders ${LANG_SPANISHINTERNATIONAL} "Añadir «Abrir con persephone» al menú contextual de carpetas del Explorador"
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
    LangString InstallerDefaultBrowser ${LANG_SPANISHINTERNATIONAL} "Registrar Persephone como navegador"
    LangString InstallerDefaultBrowser ${LANG_PORTUGUESEBR} "Registrar o Persephone como navegador"
    LangString InstallerDefaultBrowser ${LANG_ITALIAN} "Registra Persephone come browser"
    LangString InstallerDefaultBrowser ${LANG_SIMPCHINESE} "将 Persephone 注册为浏览器"
    LangString InstallerDefaultBrowser ${LANG_JAPANESE} "Persephone をブラウザーとして登録"
    LangString InstallerDefaultBrowser ${LANG_KOREAN} "Persephone을 브라우저로 등록"

    ; Override electron-builder's English fallbacks for messages missing from its NSIS catalogs.
    ; These translations follow the installer terminology used by NSIS and the language glossary.
    ; Ukrainian
    LangString win7Required ${LANG_UKRAINIAN} "Потрібна Windows 7 або новіша версія"
    LangString x64WinRequired ${LANG_UKRAINIAN} "Потрібна 64-розрядна версія Windows"
    LangString installing ${LANG_UKRAINIAN} "Триває встановлення, зачекайте..."
    LangString areYouSureToUninstall ${LANG_UKRAINIAN} "Ви впевнені, що хочете видалити ${PRODUCT_NAME}?"
    LangString chooseInstallationOptions ${LANG_UKRAINIAN} "Вибір параметрів встановлення"
    LangString chooseUninstallationOptions ${LANG_UKRAINIAN} "Вибір параметрів видалення"
    LangString whichInstallationShouldBeRemoved ${LANG_UKRAINIAN} "Яке встановлення слід видалити?"
    LangString whoShouldThisApplicationBeInstalledFor ${LANG_UKRAINIAN} "Для кого встановити цю програму?"
    LangString selectUserMode ${LANG_UKRAINIAN} "Виберіть, чи зробити програму доступною для всіх користувачів, чи лише для вас"
    LangString whichInstallationRemove ${LANG_UKRAINIAN} "Цю програму встановлено для всіх користувачів і окремо для користувача.\nЯке встановлення потрібно видалити?"
    LangString freshInstallForAll ${LANG_UKRAINIAN} "Нове встановлення для всіх користувачів (потрібні облікові дані адміністратора)"
    LangString freshInstallForCurrent ${LANG_UKRAINIAN} "Нове встановлення лише для поточного користувача."
    LangString onlyForMe ${LANG_UKRAINIAN} "Лише для &мене"
    LangString forAll ${LANG_UKRAINIAN} "Для &всіх користувачів цього комп’ютера"
    LangString loginWithAdminAccount ${LANG_UKRAINIAN} "Щоб продовжити, увійдіть за допомогою облікового запису з групи адміністраторів..."
    LangString perUserInstallExists ${LANG_UKRAINIAN} "Вже встановлено для окремого користувача."
    LangString perUserInstall ${LANG_UKRAINIAN} "Програму встановлено для окремого користувача."
    LangString perMachineInstallExists ${LANG_UKRAINIAN} "Програму вже встановлено для всіх користувачів."
    LangString perMachineInstall ${LANG_UKRAINIAN} "Програму встановлено для всіх користувачів."
    LangString reinstallUpgrade ${LANG_UKRAINIAN} "Буде виконано повторне встановлення або оновлення."
    LangString uninstall ${LANG_UKRAINIAN} "Програму буде видалено."

    ; Lithuanian
    LangString win7Required ${LANG_LITHUANIAN} "Reikalinga Windows 7 arba naujesnė versija"
    LangString x64WinRequired ${LANG_LITHUANIAN} "Reikalinga 64 bitų Windows versija"
    LangString installing ${LANG_LITHUANIAN} "Diegiama, palaukite..."
    LangString areYouSureToUninstall ${LANG_LITHUANIAN} "Ar tikrai norite pašalinti ${PRODUCT_NAME}?"
    LangString chooseInstallationOptions ${LANG_LITHUANIAN} "Diegimo parinkčių pasirinkimas"
    LangString chooseUninstallationOptions ${LANG_LITHUANIAN} "Pašalinimo parinkčių pasirinkimas"
    LangString whichInstallationShouldBeRemoved ${LANG_LITHUANIAN} "Kurį diegimą pašalinti?"
    LangString whoShouldThisApplicationBeInstalledFor ${LANG_LITHUANIAN} "Kam įdiegti šią programą?"
    LangString selectUserMode ${LANG_LITHUANIAN} "Pasirinkite, ar padaryti šią programą prieinamą visiems naudotojams, ar tik jums"
    LangString whichInstallationRemove ${LANG_LITHUANIAN} "Ši programa įdiegta visiems naudotojams ir atskirai naudotojui.\nKurį diegimą norite pašalinti?"
    LangString freshInstallForAll ${LANG_LITHUANIAN} "Naujai įdiegti visiems naudotojams (reikės administratoriaus prisijungimo duomenų)"
    LangString freshInstallForCurrent ${LANG_LITHUANIAN} "Naujai įdiegti tik dabartiniam naudotojui."
    LangString onlyForMe ${LANG_LITHUANIAN} "Tik &man"
    LangString forAll ${LANG_LITHUANIAN} "Visiems šio kompiuterio naudotojams (&visiems)"
    LangString loginWithAdminAccount ${LANG_LITHUANIAN} "Norėdami tęsti, prisijunkite paskyra, priklausančia administratorių grupei..."
    LangString perUserInstallExists ${LANG_LITHUANIAN} "Programa jau įdiegta tik šiam naudotojui."
    LangString perUserInstall ${LANG_LITHUANIAN} "Programa įdiegta tik šiam naudotojui."
    LangString perMachineInstallExists ${LANG_LITHUANIAN} "Programa jau įdiegta visiems naudotojams."
    LangString perMachineInstall ${LANG_LITHUANIAN} "Programa įdiegta visiems naudotojams."
    LangString reinstallUpgrade ${LANG_LITHUANIAN} "Programa bus įdiegta iš naujo arba atnaujinta."
    LangString uninstall ${LANG_LITHUANIAN} "Programa bus pašalinta."

    ; Latvian
    LangString win7Required ${LANG_LATVIAN} "Nepieciešama Windows 7 vai jaunāka versija"
    LangString x64WinRequired ${LANG_LATVIAN} "Nepieciešama 64 bitu Windows versija"
    LangString appRunning ${LANG_LATVIAN} "${PRODUCT_NAME} darbojas.$\r$\nNoklikšķiniet uz Labi, lai to aizvērtu.$\r$\nJa tas netiek aizvērts, aizveriet to manuāli."
    LangString appCannotBeClosed ${LANG_LATVIAN} "${PRODUCT_NAME} nevar aizvērt. $\r$\nLūdzu, aizveriet to manuāli un noklikšķiniet uz Mēģināt vēlreiz, lai turpinātu."
    LangString installing ${LANG_LATVIAN} "Notiek instalēšana, lūdzu, uzgaidiet..."
    LangString areYouSureToUninstall ${LANG_LATVIAN} "Vai tiešām vēlaties atinstalēt ${PRODUCT_NAME}?"
    LangString chooseInstallationOptions ${LANG_LATVIAN} "Izvēlieties instalēšanas opcijas"
    LangString chooseUninstallationOptions ${LANG_LATVIAN} "Izvēlieties atinstalēšanas opcijas"
    LangString whichInstallationShouldBeRemoved ${LANG_LATVIAN} "Kura instalācija jāatinstalē?"
    LangString whoShouldThisApplicationBeInstalledFor ${LANG_LATVIAN} "Kam instalēt šo lietojumprogrammu?"
    LangString selectUserMode ${LANG_LATVIAN} "Izvēlieties, vai padarīt šo programmatūru pieejamu visiem lietotājiem vai tikai jums"
    LangString whichInstallationRemove ${LANG_LATVIAN} "Šī programmatūra ir instalēta visiem lietotājiem un atsevišķam lietotājam.\nKuru instalāciju vēlaties atinstalēt?"
    LangString freshInstallForAll ${LANG_LATVIAN} "Jauna instalēšana visiem lietotājiem (tiks pieprasīti administratora akreditācijas dati)"
    LangString freshInstallForCurrent ${LANG_LATVIAN} "Jauna instalēšana tikai pašreizējam lietotājam."
    LangString onlyForMe ${LANG_LATVIAN} "Tikai &man"
    LangString forAll ${LANG_LATVIAN} "Visiem šī datora lietotājiem (&visiem)"
    LangString loginWithAdminAccount ${LANG_LATVIAN} "Lai turpinātu, piesakieties ar kontu, kas ir administratoru grupā..."
    LangString perUserInstallExists ${LANG_LATVIAN} "Programma jau ir instalēta atsevišķam lietotājam."
    LangString perUserInstall ${LANG_LATVIAN} "Programma ir instalēta atsevišķam lietotājam."
    LangString perMachineInstallExists ${LANG_LATVIAN} "Programma jau ir instalēta visiem lietotājiem."
    LangString perMachineInstall ${LANG_LATVIAN} "Programma ir instalēta visiem lietotājiem."
    LangString reinstallUpgrade ${LANG_LATVIAN} "Programma tiks instalēta atkārtoti vai atjaunināta."
    LangString uninstall ${LANG_LATVIAN} "Programma tiks atinstalēta."

    ; Estonian
    LangString win7Required ${LANG_ESTONIAN} "Vajalik on Windows 7 või uuem versioon"
    LangString x64WinRequired ${LANG_ESTONIAN} "Vajalik on 64-bitine Windows"
    LangString appRunning ${LANG_ESTONIAN} "${PRODUCT_NAME} töötab.$\r$\nKlõpsake sulgemiseks nuppu OK.$\r$\nKui see ei sulgu, sulgege see käsitsi."
    LangString installing ${LANG_ESTONIAN} "Installimine, palun oodake..."
    LangString areYouSureToUninstall ${LANG_ESTONIAN} "Kas soovite kindlasti ${PRODUCT_NAME}i desinstallida?"
    LangString chooseInstallationOptions ${LANG_ESTONIAN} "Installisuvandite valimine"
    LangString chooseUninstallationOptions ${LANG_ESTONIAN} "Desinstallimissuvandite valimine"
    LangString whichInstallationShouldBeRemoved ${LANG_ESTONIAN} "Milline install tuleks eemaldada?"
    LangString whoShouldThisApplicationBeInstalledFor ${LANG_ESTONIAN} "Kelle jaoks see rakendus installida?"
    LangString selectUserMode ${LANG_ESTONIAN} "Valige, kas teha see tarkvara kättesaadavaks kõigile kasutajatele või ainult teile"
    LangString whichInstallationRemove ${LANG_ESTONIAN} "See tarkvara on installitud kõigile kasutajatele ja eraldi kasutajale.\nMillise installi soovite eemaldada?"
    LangString freshInstallForAll ${LANG_ESTONIAN} "Uus install kõigile kasutajatele (küsitakse administraatori mandaati)"
    LangString freshInstallForCurrent ${LANG_ESTONIAN} "Uus install ainult praegusele kasutajale."
    LangString onlyForMe ${LANG_ESTONIAN} "Ainult &mulle"
    LangString forAll ${LANG_ESTONIAN} "Kõigile selle arvuti kasutajatele (&kõigile)"
    LangString loginWithAdminAccount ${LANG_ESTONIAN} "Jätkamiseks logige sisse administraatorite rühma kuuluva kontoga..."
    LangString perUserInstallExists ${LANG_ESTONIAN} "Rakendus on juba konkreetsele kasutajale installitud."
    LangString perUserInstall ${LANG_ESTONIAN} "Rakendus on konkreetsele kasutajale installitud."
    LangString perMachineInstallExists ${LANG_ESTONIAN} "Rakendus on juba kõigile kasutajatele installitud."
    LangString perMachineInstall ${LANG_ESTONIAN} "Rakendus on kõigile kasutajatele installitud."
    LangString reinstallUpgrade ${LANG_ESTONIAN} "Rakendus installitakse uuesti või värskendatakse."
    LangString uninstall ${LANG_ESTONIAN} "Rakendus desinstallitakse."

    ; Belarusian
    LangString win7Required ${LANG_BELARUSIAN} "Патрабуецца Windows 7 або навейшая версія"
    LangString x64WinRequired ${LANG_BELARUSIAN} "Патрабуецца 64-разрадная версія Windows"
    LangString appRunning ${LANG_BELARUSIAN} "${PRODUCT_NAME} запушчана.$\r$\nНацісніце «ОК», каб закрыць праграму.$\r$\nКалі яна не закрыецца, паспрабуйце закрыць яе ўручную."
    LangString appCannotBeClosed ${LANG_BELARUSIAN} "Не ўдалося закрыць ${PRODUCT_NAME}. $\r$\nЗакрыйце праграму ўручную і націсніце «Паўтарыць», каб працягнуць."
    LangString installing ${LANG_BELARUSIAN} "Ідзе ўсталяванне, пачакайце..."
    LangString areYouSureToUninstall ${LANG_BELARUSIAN} "Вы сапраўды хочаце выдаліць ${PRODUCT_NAME}?"
    LangString chooseInstallationOptions ${LANG_BELARUSIAN} "Выбар параметраў усталявання"
    LangString chooseUninstallationOptions ${LANG_BELARUSIAN} "Выбар параметраў выдалення"
    LangString whichInstallationShouldBeRemoved ${LANG_BELARUSIAN} "Якое ўсталяванне трэба выдаліць?"
    LangString whoShouldThisApplicationBeInstalledFor ${LANG_BELARUSIAN} "Для каго ўсталяваць гэту праграму?"
    LangString selectUserMode ${LANG_BELARUSIAN} "Выберыце, зрабіць праграму даступнай усім карыстальнікам ці толькі вам"
    LangString whichInstallationRemove ${LANG_BELARUSIAN} "Гэта праграма ўсталявана для ўсіх карыстальнікаў і асобна для карыстальніка.\nЯкое ўсталяванне вы хочаце выдаліць?"
    LangString freshInstallForAll ${LANG_BELARUSIAN} "Новае ўсталяванне для ўсіх карыстальнікаў (спатрэбяцца ўліковыя даныя адміністратара)"
    LangString freshInstallForCurrent ${LANG_BELARUSIAN} "Новае ўсталяванне толькі для бягучага карыстальніка."
    LangString onlyForMe ${LANG_BELARUSIAN} "Толькі для &мяне"
    LangString forAll ${LANG_BELARUSIAN} "Для ўсіх карыстальнікаў гэтага камп'ютара (&усіх)"
    LangString loginWithAdminAccount ${LANG_BELARUSIAN} "Каб працягнуць, увайдзіце з дапамогай уліковага запісу з групы адміністратараў..."
    LangString perUserInstallExists ${LANG_BELARUSIAN} "Праграма ўжо ўсталявана для асобнага карыстальніка."
    LangString perUserInstall ${LANG_BELARUSIAN} "Праграма ўсталявана для асобнага карыстальніка."
    LangString perMachineInstallExists ${LANG_BELARUSIAN} "Праграма ўжо ўсталявана для ўсіх карыстальнікаў."
    LangString perMachineInstall ${LANG_BELARUSIAN} "Праграма ўсталявана для ўсіх карыстальнікаў."
    LangString reinstallUpgrade ${LANG_BELARUSIAN} "Будзе выканана паўторнае ўсталяванне або абнаўленне."
    LangString uninstall ${LANG_BELARUSIAN} "Праграма будзе выдалена."

    ; Romanian
    LangString win7Required ${LANG_ROMANIAN} "Este necesar Windows 7 sau o versiune mai recentă"
    LangString x64WinRequired ${LANG_ROMANIAN} "Este necesară o versiune Windows pe 64 de biți"
    LangString installing ${LANG_ROMANIAN} "Se instalează, așteptați..."
    LangString areYouSureToUninstall ${LANG_ROMANIAN} "Sigur doriți să dezinstalați ${PRODUCT_NAME}?"
    LangString chooseInstallationOptions ${LANG_ROMANIAN} "Alegeți opțiunile de instalare"
    LangString chooseUninstallationOptions ${LANG_ROMANIAN} "Alegeți opțiunile de dezinstalare"
    LangString whichInstallationShouldBeRemoved ${LANG_ROMANIAN} "Care instalare trebuie eliminată?"
    LangString whoShouldThisApplicationBeInstalledFor ${LANG_ROMANIAN} "Pentru cine să fie instalată această aplicație?"
    LangString selectUserMode ${LANG_ROMANIAN} "Alegeți dacă doriți ca acest software să fie disponibil pentru toți utilizatorii sau doar pentru dvs."
    LangString whichInstallationRemove ${LANG_ROMANIAN} "Acest software este instalat pentru toți utilizatorii și pentru un singur utilizator.\nCare instalare doriți să o eliminați?"
    LangString freshInstallForAll ${LANG_ROMANIAN} "Instalare nouă pentru toți utilizatorii (se vor solicita datele de administrator)"
    LangString freshInstallForCurrent ${LANG_ROMANIAN} "Instalare nouă doar pentru utilizatorul curent."
    LangString onlyForMe ${LANG_ROMANIAN} "Doar pentru &mine"
    LangString forAll ${LANG_ROMANIAN} "Pentru toți utilizatorii acestui computer (&toți)"
    LangString loginWithAdminAccount ${LANG_ROMANIAN} "Pentru a continua, conectați-vă cu un cont membru al grupului de administratori..."
    LangString perUserInstallExists ${LANG_ROMANIAN} "Există deja o instalare pentru un singur utilizator."
    LangString perUserInstall ${LANG_ROMANIAN} "Există o instalare pentru un singur utilizator."
    LangString perMachineInstallExists ${LANG_ROMANIAN} "Există deja o instalare pentru toți utilizatorii."
    LangString perMachineInstall ${LANG_ROMANIAN} "Există o instalare pentru toți utilizatorii."
    LangString reinstallUpgrade ${LANG_ROMANIAN} "Se va reinstala sau actualiza."
    LangString uninstall ${LANG_ROMANIAN} "Se va dezinstala."

    ; Korean
    LangString appCannotBeClosed ${LANG_KOREAN} "${PRODUCT_NAME}을(를) 닫을 수 없습니다. $\r$\n수동으로 닫은 다음 다시 시도를 눌러 계속하세요."
    LangString decompressionFailed ${LANG_KOREAN} "파일 압축을 풀지 못했습니다. 설치 프로그램을 다시 실행해 주세요."
    LangString uninstallFailed ${LANG_KOREAN} "이전 앱 파일을 제거하지 못했습니다. 설치 프로그램을 다시 실행해 주세요."
    LangString appClosing ${LANG_KOREAN} "실행 중인 ${PRODUCT_NAME}을(를) 닫는 중..."

    ; Simplified Chinese
    LangString decompressionFailed ${LANG_SIMPCHINESE} "解压文件失败。请重新运行安装程序。"
    LangString uninstallFailed ${LANG_SIMPCHINESE} "卸载旧应用文件失败。请重新运行安装程序。"
    LangString appClosing ${LANG_SIMPCHINESE} "正在关闭运行中的 ${PRODUCT_NAME}..."

    ; Polish
    LangString appClosing ${LANG_POLISH} "Zamykanie uruchomionego programu ${PRODUCT_NAME}..."

    ; Slovak
    LangString appClosing ${LANG_SLOVAK} "Zatvára sa spustený program ${PRODUCT_NAME}..."
    LangString freshInstallForCurrent ${LANG_SLOVAK} "Nová inštalácia len pre aktuálneho používateľa."
    LangString perUserInstallExists ${LANG_SLOVAK} "Inštalácia pre jedného používateľa už existuje."
    LangString perUserInstall ${LANG_SLOVAK} "Existuje inštalácia pre jedného používateľa."
    LangString perMachineInstallExists ${LANG_SLOVAK} "Inštalácia pre všetkých používateľov už existuje."
    LangString perMachineInstall ${LANG_SLOVAK} "Existuje inštalácia pre všetkých používateľov."
    LangString reinstallUpgrade ${LANG_SLOVAK} "Prebehne opätovná inštalácia alebo aktualizácia."
    LangString uninstall ${LANG_SLOVAK} "Prebehne odinštalovanie."

    ; Hungarian
    LangString appClosing ${LANG_HUNGARIAN} "A futó ${PRODUCT_NAME} bezárása..."

    ; German
    LangString appClosing ${LANG_GERMAN} "${PRODUCT_NAME} wird geschlossen..."

    ; French
    LangString appClosing ${LANG_FRENCH} "Fermeture de ${PRODUCT_NAME} en cours..."

    ; Spanish
    LangString appClosing ${LANG_SPANISHINTERNATIONAL} "Cerrando ${PRODUCT_NAME}..."

    ; Brazilian Portuguese
    LangString appClosing ${LANG_PORTUGUESEBR} "Fechando o ${PRODUCT_NAME} em execução..."

    ; Italian
    LangString appClosing ${LANG_ITALIAN} "Chiusura di ${PRODUCT_NAME} in esecuzione..."

    ; Japanese
    LangString appClosing ${LANG_JAPANESE} "実行中の${PRODUCT_NAME}を終了しています..."

    ; Remaining messages absent from the NSIS catalogs
    LangString decompressionFailed ${LANG_LATVIAN} "Neizdevās atspiest failus. Lūdzu, mēģiniet vēlreiz palaist instalēšanas programmu."
    LangString uninstallFailed ${LANG_LATVIAN} "Neizdevās atinstalēt iepriekšējās lietojumprogrammas failus. Lūdzu, mēģiniet vēlreiz palaist instalēšanas programmu."
    LangString appClosing ${LANG_UKRAINIAN} "Закриття запущеної програми ${PRODUCT_NAME}..."
    LangString appClosing ${LANG_LITHUANIAN} "Uždaroma veikianti ${PRODUCT_NAME} programa..."
    LangString appClosing ${LANG_LATVIAN} "Tiek aizvērta palaistā programma ${PRODUCT_NAME}..."
    LangString decompressionFailed ${LANG_ESTONIAN} "Failide lahtipakkimine nurjus. Käivitage installiprogramm uuesti."
    LangString uninstallFailed ${LANG_ESTONIAN} "Eelmise rakenduse failide desinstallimine nurjus. Käivitage installiprogramm uuesti."
    LangString appClosing ${LANG_ESTONIAN} "Töötava ${PRODUCT_NAME} sulgemine..."
    LangString decompressionFailed ${LANG_BELARUSIAN} "Не ўдалося распакаваць файлы. Паспрабуйце зноў запусціць праграму ўсталявання."
    LangString uninstallFailed ${LANG_BELARUSIAN} "Не ўдалося выдаліць файлы старой праграмы. Паспрабуйце зноў запусціць праграму ўсталявання."
    LangString appClosing ${LANG_BELARUSIAN} "Закрыццё запушчанай праграмы ${PRODUCT_NAME}..."
    LangString appClosing ${LANG_ROMANIAN} "Se închide aplicația ${PRODUCT_NAME}..."
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
; preInit — installer language selection
; ========================================================================
; electron-builder's displayLanguageSelector shows the dialog in .onInit, which also
; runs in the elevated copy started for a per-machine install, so the user was asked
; twice. Ask only in the outer instance and copy its choice into the elevated one.
; LangDLL preselects the OS language and stays hidden in silent mode.

!macro preInit
    !ifndef BUILD_UNINSTALLER
        ${If} ${UAC_IsInnerInstance}
            !insertmacro UAC_AsUser_GetGlobalVar $LANGUAGE
        ${Else}
            !insertmacro MUI_LANGDLL_DISPLAY
        ${EndIf}
    !endif
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
