# Functionality Mapping to Interface Objects

Maps ALL existing app functionality to proposed interface objects.
Identifies gaps — functionality that doesn't fit any proposed interface.

---

## app.pages — IPageCollection

| Capability | Current source | Notes |
|------------|---------------|-------|
| Add/create empty page | `pagesModel.addEmptyPage()` | |
| Create page with editor | `pagesModel.addEditorPage()` | |
| Create page from file | `pagesModel.createPageFromFile()` | |
| Open file (reuse or new) | `pagesModel.openFile()` | |
| Open file via dialog | `pagesModel.openFileWithDialog()` | |
| Open diff (two files grouped) | `pagesModel.openDiff()` | |
| Find page by id | `pagesModel.findPage()` | |
| Active page | `pagesModel.activePage` | |
| Show page | `pagesModel.showPage()` | |
| Show next / previous | `pagesModel.showNext()` / `showPrevious()` | |
| Close other pages | `pagesModel.closeOtherPages()` | |
| Close to the right | `pagesModel.closeToTheRight()` | |
| Duplicate page | `pagesModel.duplicatePage()` | |
| Group pages | `pagesModel.group()` / `groupTabs()` | |
| Ungroup | `pagesModel.ungroup()` | |
| Get grouped page | `pagesModel.getGroupedPage()` | |
| Pin / unpin tab | `pagesModel.pinTab()` / `unpinTab()` | |
| Move tab | `pagesModel.moveTab()` / `moveTabByIndex()` | |
| Move page to window | `pagesModel.movePageOut()` | |
| Receive page from window | `pagesModel.movePageIn()` | |
| Navigate page to file | `pagesModel.navigatePageTo()` | |
| Open in new window | `pagesModel.openPathInNewWindow()` | |
| Handle URL opening | `pagesModel.handleOpenUrl()` | |
| Events: onShow, onFocus | `pagesModel.onShow` / `onFocus` | |
| State save/restore | `pagesModel.saveState()` / `restoreState()` | Internal — not exposed |

---

## page — IPage (common for all page types)

| Capability | Current source | Notes |
|------------|---------------|-------|
| id, type, filePath, title | `PageModel` base | |
| content read/write | `TextFileModel.content` via `ScriptContext` | Text pages only |
| language read/write | `PageModel.changeLanguage()` | |
| editor type read/write | `TextFileModel.changeEditor()` | |
| modified flag | `TextFileModel.modified` | Text pages only |
| pinned flag | `PageModel.state.pinned` | |
| pin / unpin | via `pagesModel.pinTab()` | Currently on pagesModel, not page |
| close | via page.onClose / pagesModel | |
| save / save as | `TextFileModel.saveFile()` | Text pages only |
| grouped page access | `pagesModel.getGroupedPage()` | |
| persistent data | `ScriptPanelModel.data` | Currently only via script panel |
| rename file | `TextFileModel.renameFile()` | |
| dispose / cleanup | `PageModel.dispose()` | Internal |
| restore from state | `PageModel.restore()` | Internal |
| compare mode | `TextFileModel.setCompareMode()` | Text pages only |
| encryption | `TextFileModel.encript()` / `decript()` | Text pages only |
| encoding | `TextFileModel.encoding` | Text pages only |

---

## page.asText() — ITextEditor

| Capability | Current source | Notes |
|------------|---------------|-------|
| Change content | `TextFileModel.changeContent()` | |
| Get selected text | `TextEditorModel.getSelectedText()` | |
| Reveal line | `TextEditorModel.revealLine()` | |
| Highlight text | `TextEditorModel.setHighlightText()` | |
| Focus editor | `TextEditorModel.focusEditor()` | |
| Run script | `TextFileModel.runScript()` | |
| Run related script | `TextFileModel.runRelatedScript()` | |
| Script panel access | `TextFileModel.script` | |
| Compare mode | `TextFileModel.setCompareMode()` | |
| Encryption | `TextFileModel.encript()` / `decript()` | |
| File monitoring | `TextFileModel` file watcher | Internal |
| Encoding | `TextFileModel.encoding` | |

**Missing from Monaco (not yet exposed):**
- Get/set cursor position
- Get/set selections (multiple)
- Insert at position
- Get line by number
- Line count
- Find/replace operations
- Undo/redo

---

## page.asBrowser() — IBrowserEditor

| Capability | Current source | Notes |
|------------|---------------|-------|
| Navigate to URL | `BrowserPageModel.navigate()` | |
| Go back / forward | `goBack()` / `goForward()` | |
| Reload / hard reload | `reload()` / `reloadIgnoringCache()` | |
| Stop loading | `stop()` | |
| Go home | `goHome()` | |
| Current URL | `currentUrl` | |
| Add tab | `addTab()` | |
| Close tab | `closeTab()` | |
| Switch tab | `switchTab()` | |
| Active tab | `activeTab` | |
| All tabs | `tabs` | |
| Search engine get/set | `getSearchEngine()` / `setSearchEngine()` | |
| Find in page | `openFind()` / `closeFind()` / `findNext()` / `findPrev()` | |
| Profile info | `profileName` / `isIncognito` | |
| Bookmarks toggle | `toggleBookmark()` | |
| Is bookmarked | `isBookmarked` | |
| Get bookmarks | `getBookmarks()` | |
| Favicon cache | `cacheFavicon()` / `getCachedFavicon()` | |
| Mute/unmute | `pageMuted` | |
| Open DevTools | `openDevTools()` | |
| URL bar focus | `focusUrlInput()` | |
| Execute JS in page | via `webview.executeJavaScript()` | Not exposed yet |
| Get page source | via webview | Not exposed yet |

---

## page.asGrid() — IGridEditor

| Capability | Current source | Notes |
|------------|---------------|-------|
| Set data | `GridPageModel.setData()` | |
| Get rows / columns | `rows` / `columns` | |
| Get filtered rows | `filteredRows` | |
| Update cell | `updateCell()` | |
| Add / delete / duplicate row | `addRow()` / `deleteRow()` / `duplicateRow()` | |
| Add / remove / rename column | `addColumn()` / `removeColumn()` / `renameColumn()` | |
| Resize column | `setColumnWidth()` | |
| Hide / show column | `hideColumn()` / `showColumn()` | |
| Move column | `moveColumn()` | |
| Sort | `setSortColumn()` | |
| Add / remove / clear filters | `addFilter()` / `removeFilter()` / `clearFilters()` | |
| Search | `search()` | |
| Import / export CSV | `importCsv()` / `exportCsv()` | |
| CSV delimiter | `setCsvDelimiter()` | |

---

## page.asNotebook() — INotebookEditor

| Capability | Current source | Notes |
|------------|---------------|-------|
| Add / delete / rename / duplicate note | CRUD methods | |
| Move note | `moveNote()` | |
| Get note | `getNote()` | |
| Categories CRUD | `addCategory()` / `renameCategory()` / `deleteCategory()` | |
| Tags add / remove / getAll | tag methods | |
| Filter by category / tag | `setSelectedCategory()` / `setSelectedTag()` | |
| Search | `searchText()` | |
| Note content update | `updateNoteContent()` | |
| Note editor/language change | `updateNoteEditor()` / `updateNoteLanguage()` | |

---

## page.asTodo() — ITodoEditor (NEW — was missing)

| Capability | Current source | Notes |
|------------|---------------|-------|
| Add / remove / toggle / edit todo | CRUD methods | |
| Move todo | `moveTodo()` | |
| Categories | `addCategory()` | |
| Tags | `addTag()` | |
| Group by category | grouping | |
| Filter by tag | filtering | |
| Search | search | |

---

## page.asLinks() — ILinksEditor (NEW — was missing)

| Capability | Current source | Notes |
|------------|---------------|-------|
| Add / remove / edit link | CRUD methods | |
| Add folder | `addFolder()` | |
| Move link | `moveLink()` | |
| Favicon display | favicon caching | |

---

## app.ui — IUserInterface

| Capability | Current source | Notes |
|------------|---------------|-------|
| Confirmation dialog | `showConfirmationDialog()` | |
| Input dialog | `showInputDialog()` | |
| Password dialog | `showPasswordDialog()` | |
| Popup/context menu | `showPopupMenu()` | |

**Missing (should add):**
- Toast/notification (non-modal)
- Progress indicator for long operations
- Status bar text
- Pick from list dialog

---

## app.settings — ISettings

| Capability | Current source | Notes |
|------------|---------------|-------|
| Get setting | `appSettings.get()` | |
| Set setting | `appSettings.set()` | |
| React hook | `appSettings.use()` | |
| All setting keys | typed keys in app-settings.ts | |
| Auto-persist | debounced save | Internal |
| File watching | external edit detection | Internal |

---

## app.fs — IFileSystem

| Capability | Current source | Notes |
|------------|---------------|-------|
| Read text file | `filesModel.getFile()` | |
| Write text file | `filesModel.saveFile()` | |
| Read binary file | `filesModel.getBinaryFile()` | |
| Write binary file | `filesModel.saveBinaryFile()` | |
| Delete file | `filesModel.deleteFile()` | |
| File exists | `filesModel.fileExists()` | |
| Prepare file (create if missing) | `filesModel.prepareFile()` | |
| Open file dialog | IPC `showOpenFileDialog` | |
| Save file dialog | IPC `showSaveFileDialog` | |
| Open folder dialog | IPC `showOpenFolderDialog` | |
| Cache file read/write | `filesModel.getCacheFile()` / `saveCacheFile()` | Internal — not for public API |
| Data file read/write | `filesModel.getDataFile()` / `saveDataFile()` | Internal — not for public API |
| Get common folder paths | IPC `getCommonFolder` | Documents, Downloads, Desktop, etc. |
| Show in file explorer | IPC `showItemInFolder` | |

---

## app.window — IWindow

| Capability | Current source | Notes |
|------------|---------------|-------|
| Maximize | IPC `maximizeWindow` | |
| Minimize | IPC `minimizeWindow` | |
| Restore | IPC `restoreWindow` | |
| Close | IPC `closeWindow` | |
| Open new window | IPC `openNewWindow` | |
| Zoom | IPC `zoom` / `resetZoom` | |
| Is maximized event | `eWindowMaximized` | |
| Window index | `filesModel.windowIndex` | |
| Get all window pages | IPC `getWindowPages` | |
| Show page in window | IPC `showWindowPage` | |
| Set native theme | IPC `setNativeTheme` | |

---

## app.editors — IEditorRegistry

| Capability | Current source | Notes |
|------------|---------------|-------|
| List all editors | `editorRegistry.getAll()` | |
| Get by id | `editorRegistry.getById()` | |
| Resolve for file | `editorRegistry.resolve()` | |
| Validate for language | `editorRegistry.validateForLanguage()` | |
| Get switch options | `editorRegistry.getSwitchOptions()` | |

---

## GAPS — Resolved

### 1. Downloads → part of `IBrowserEditor`

Downloads are initiated by user clicks in browser pages. Not a standalone download manager. Expose as `page.asBrowser().downloads` — a list of download entries with cancel/open/showInFolder. If a standalone download manager is needed in the future, it becomes a separate interface then.

### 2. Recent files → `app.recent` (IRecentFiles)

Small interface: list of file paths with add/remove/clear. Lives on `app.recent`.

### 3. Sidebar folders → subinterface of `app.ui`

`app.ui.folders` — folder shortcuts in the sidebar. Add/remove/reorder.

### 4. File search → `app.shell.fileSearch` (service)

Complex functionality that doesn't rely on React rendering. Goes into services.

### 5. Version / updates → `app.shell.version` (service)

AI bot can check version and updates without opening the About page. The About page becomes a simple IPage that calls the service internally.

### 6. Shell integration → `app.shell` (IShell)

Dedicated interface for OS-level operations:
- `showInFolder(path)`, `showFolder(path)` — explorer integration
- `registerAsDefaultBrowser()`, `unregisterAsDefaultBrowser()` — browser registration
- `spawn(command, args)` — run process and get result (useful one-liner wrapper)
- `openExternal(url)` — open URL in OS default browser
- Plus sub-services: `app.shell.fileSearch`, `app.shell.version`, `app.shell.encryption`

### 7. Language mapping → part of `app.editors`

Put it there for now. Revisit if needed.

### 8. Scripting system → `app.shell.scripting` (service)

AI bot needs to execute scripts programmatically. `app.shell.scripting.run(code, page?)` — execute JS code in script context, return result.

---

## Summary: Final Interface Object List

### Core (always available)
| Interface | Name | Description |
|-----------|------|-------------|
| IApp | `app` | Root — aggregates everything |
| IPageCollection | `app.pages` | Workspace management |
| IUserInterface | `app.ui` | Dialogs, notifications, menus, sidebar folders |
| ISettings | `app.settings` | Configuration |
| IFileSystem | `app.fs` | File I/O, dialogs, paths |
| IWindow | `app.window` | Window state, zoom, multi-window |
| IEditorRegistry | `app.editors` | Editor discovery, language mapping |
| IRecentFiles | `app.recent` | Recent file history |
| IShell | `app.shell` | OS integration, spawn, services |

### Services (via app.shell)
| Interface | Name | Description |
|-----------|------|-------------|
| IFileSearchService | `app.shell.fileSearch` | Search file content across folders |
| IVersionService | `app.shell.version` | App version, runtime info, update check |
| IEncryptionService | `app.shell.encryption` | Encrypt/decrypt content |
| IScriptingService | `app.shell.scripting` | Execute scripts programmatically |

### Per-page (common)
| Interface | Name | Description |
|-----------|------|-------------|
| IPage | `page` | Single document — identity, content, lifecycle |

### Per-page (editor-specific, lazy)
| Interface | Accessor | Description |
|-----------|----------|-------------|
| ITextEditor | `page.asText()` | Monaco: selections, find, scripting |
| IBrowserEditor | `page.asBrowser()` | Browser: navigation, tabs, bookmarks, downloads |
| IGridEditor | `page.asGrid()` | Grid: rows, columns, sort, filter |
| INotebookEditor | `page.asNotebook()` | Notes: categories, items, tags |
| ITodoEditor | `page.asTodo()` | Todos: items, categories, tags |
| ILinksEditor | `page.asLinks()` | Links: bookmarks, folders |
| IMarkdownEditor | `page.asMarkdown()` | Preview: search, scroll, export |
