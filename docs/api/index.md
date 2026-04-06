[← Home](../index.md) · [Scripting Guide](../scripting.md)

# Scripting API Reference

Scripts have access to four globals — `page`, `app`, `ui`, and `io` — plus helpers `preventOutput()` and `styledText()`. No imports needed.

```javascript
const text = page.content;
const theme = app.settings.theme;
ui.log("Hello");
```

---

## API Tree

- **[page](./page.md)** — Current page (tab)
  - `.id` — Unique page identifier
  - `.type` — Page type (e.g. `"textFile"`)
  - `.title` — Display title
  - `.modified` — Has unsaved changes?
  - `.pinned` — Is tab pinned?
  - `.filePath` — File path (if file-backed)
  - `.content` — Text content *(read/write)*
  - `.language` — Language ID *(read/write)*
  - `.editor` — Active editor ID *(read/write)*
  - `.data` — In-memory storage across script runs
  - `.grouped` — Grouped partner page (auto-creates) → `IPage`
  - [`.runScript()`](./page.md#runscriptpromisestring) — Run page content as script (F5)
  - **[.asText()](./page.md#astextpromiseitexteditor)** — Monaco text editor facade
    - `.editorMounted` — True when editor is visible
    - `.getSelectedText()` — Currently selected text
    - `.getCursorPosition()` — `{lineNumber, column}`
    - `.insertText(text)` — Insert at cursor
    - `.replaceSelection(text)` — Replace selection
    - `.revealLine(lineNumber)` — Scroll to line
    - `.setHighlightText(text)` — Highlight occurrences
  - **[.asGrid()](./page.md#asgridpromiseigrideditor)** — Grid data facade
    - `.rows` — All rows as objects
    - `.columns` — Column definitions
    - `.rowCount` — Number of rows
    - `.editCell(columnKey, rowKey, value)` — Edit a cell
    - `.addRows(count?, insertIndex?)` — Add empty rows
    - `.deleteRows(rowKeys)` — Delete rows by keys
    - `.addColumns(count?, insertBeforeKey?)` — Add columns
    - `.deleteColumns(columnKeys)` — Delete columns
    - `.setSearch(text)` / `.clearSearch()` — Filter rows
  - **[.asNotebook()](./page.md#asnotebookpromiseinotebookeditor)** — Notebook facade (`.note.json`)
    - `.notes` — All notes
    - `.categories` / `.tags` — Category and tag lists
    - `.notesCount` — Total count
    - `.addNote()` — Add note
    - `.deleteNote(id)` — Delete note
    - `.updateNoteTitle(id, title)` / `.updateNoteContent(id, content)` / `.updateNoteCategory(id, category)`
    - `.addNoteTag(id, tag)` / `.removeNoteTag(id, tagIndex)`
  - **[.asTodo()](./page.md#astodopromiseitodoeditor)** — Todo list facade (`.todo.json`)
    - `.items` — All items
    - `.lists` / `.tags` — List and tag definitions
    - `.addItem(title)` / `.toggleItem(id)` / `.deleteItem(id)` / `.updateItemTitle(id, title)`
    - `.addList(name)` / `.renameList(old, new)` / `.deleteList(name)`
    - `.addTag(name)` / `.selectList(name)` / `.selectTag(name)`
    - `.setSearch(text)` / `.clearSearch()`
  - **[.asLink()](./page.md#aslinkpromiseilinkeditor)** — Link collection facade (`.link.json`)
    - `.links` — All links
    - `.categories` / `.tags` — Category and tag lists
    - `.linksCount` — Total count
    - `.addLink(url, title?, category?)` / `.deleteLink(id)` / `.updateLink(id, props)`
  - **[.asBrowser()](./page.md#asbrowserpromiseibrowsereditor)** — Browser facade
    - `.url` / `.title` — Current URL and page title (active tab)
    - `.navigate(url)` / `.back()` / `.forward()` / `.reload()`
    - `.tabs` / `.activeTab` — Internal tab list and active tab info
    - `.addTab(url?)` / `.closeTab(tabId?)` / `.switchTab(tabId)` — Tab management
    - `.evaluate(expression, options?)` — Run JavaScript in the page → `Promise<unknown>`
    - `.snapshot(options?)` — Accessibility snapshot (Playwright MCP format) → `Promise<string>`
    - `.getText(selector, options?)` / `.getValue(selector, options?)` / `.getAttribute(selector, attr, options?)` / `.getHtml(selector, options?)` / `.exists(selector, options?)` — DOM queries
    - `.click(selector, options?)` / `.type(selector, text, options?)` / `.select(selector, value, options?)` / `.check(selector, options?)` / `.uncheck(selector, options?)` / `.clear(selector, options?)` — DOM interactions
    - `.pressKey(key, options?)` — Press a key or key combination (e.g. `"Enter"`, `"Control+a"`)
    - `.waitForSelector(selector, options?)` / `.waitForNavigation(options?)` / `.wait(ms)` — Wait helpers
  - **[.asMarkdown()](./page.md#asmarkdownpromiseimarkdowneditor)** — Markdown preview facade
    - `.viewMounted` — True if preview is mounted
    - `.html` — Rendered HTML content
  - **[.asSvg()](./page.md#assvgpromiseisvgeditor)** — SVG preview: `.svg`
  - **[.asHtml()](./page.md#ashtmlpromiseihtmleditor)** — HTML preview: `.html`
  - **[.asMermaid()](./page.md#asmermaidpromiseimermaideditor)** — Mermaid diagram preview
    - `.svgUrl` — Rendered SVG data URL
    - `.loading` / `.error` — Render state
  - **[.asGraph()](./page.md#asgraphpromiseigrapheditor)** — Graph query facade
    - `.nodes` / `.links` / `.nodeCount` / `.linkCount` / `.getNode(id)`
    - `.selectedIds` / `.selectedNodes` / `.select(ids)` / `.addToSelection(ids)` / `.clearSelection()`
    - `.getNeighborIds(id)` / `.getVisualNeighborIds(id)`
    - `.getGroupOf(id)` / `.getGroupMembers(id)` / `.getGroupMembersDeep(id)` / `.getGroupChain(id)` / `.isGroup(id)`
    - `.search(query)` / `.bfs(startId, maxDepth?)` / `.getComponents()`
    - `.rootNodeId` / `.groupingEnabled`
  - **[.asDraw()](./page.md#asdrawpromiseidraweditor)** — Drawing (Excalidraw) facade
    - `.elementCount` / `.editorIsMounted`
    - `.addImage(dataUrl, options?)` — Insert image onto canvas
    - `.exportAsSvg()` / `.exportAsPng(options?)` — Export drawing
  - **[.asMcpInspector()](./page.md#asmcpinspectorpromiseimcpinspectoreditor)** — MCP Inspector facade
    - `.connectionStatus` / `.serverName` / `.serverTitle` / `.serverVersion` / `.errorMessage`
    - `.transportType` / `.url` / `.command` / `.args` / `.connectionName` *(read/write)*
    - `.connect()` / `.disconnect()`
    - `.history` / `.historyCount` / `.clearHistory()` / `.showHistory()`

---

- **[app](./app.md)** — Application root
  - `.version` — Application version string
  - [`.fetch(url, options?)`](./app.md#fetchurl-options) — Node.js HTTP client (no browser headers)
  - **[.pages](./pages.md)** — Open pages (tabs)
    - `.all` — All open pages in the current window → `IPage[]`
    - `.activePage` — Currently active page → `IPage`
    - `.groupedPage` — Grouped partner of active page → `IPage`
    - `.findPage(pageId)` / `.getGroupedPage(withPageId)` / `.isLastPage(pageId?)` / `.isGrouped(pageId)`
    - `.openFile(filePath)` — Open a file → `Promise<IPage | undefined>`
    - `.openFileWithDialog()` — Open file via native dialog
    - `.navigatePageTo(pageId, filePath, options?)` — Navigate page to different file
    - `.closePage(pageId)` — Close a page by ID → `Promise<boolean>`
    - `.addEmptyPage()` / `.addEditorPage(editor, language, title, content?)` / `.addDrawPage(dataUrl, title?)`
    - `.openLinks(links, title?)` — Create a standalone link collection page → `IPage`
    - `.openDiff(params)` — Diff view for two files
    - `.showAboutPage()` / `.showSettingsPage()` / `.showBrowserPage(options?)` / `.showMcpInspectorPage(options?)`
    - `.openUrlInBrowserTab(url, options?)`
    - `.showPage(pageId)` / `.showNext()` / `.showPrevious()`
    - `.moveTab(fromId, toId)` / `.pinTab(pageId)` / `.unpinTab(pageId)`
    - `.group(leftId, rightId)` / `.ungroup(pageId)`
  - **[.fs](./fs.md)** — File system
    - `.read(filePath)` / `.readFile(filePath)` / `.readBinary(filePath)` — Read files
    - `.write(filePath, content)` / `.writeBinary(filePath, data)` — Write files
    - `.exists(filePath)` / `.delete(filePath)` / `.rename(old, new)` / `.copyFile(src, dest)` / `.stat(filePath)`
    - `.listDir(dirPath, pattern?)` / `.listDirWithTypes(dirPath)` — List directory
    - `.mkdir(dirPath)` / `.removeDir(dirPath, recursive?)`
    - `.resolveDataPath(rel)` / `.resolveCachePath(rel)` / `.commonFolder(name)` — Path resolution
    - `.showOpenDialog(options?)` / `.showSaveDialog(options?)` / `.showFolderDialog(options?)` — Native dialogs
    - `.showInExplorer(filePath)` / `.showFolder(folderPath)` — OS integration
  - **[.settings](./settings.md)** — Configuration
    - `.theme` — Current theme name
    - `.get(key)` / `.set(key, value)` — Read/write settings
    - `.onChanged` — Setting change event
  - **[.ui](./ui.md)** — Dialogs and notifications
    - `.confirm(message, options?)` — Confirmation dialog
    - `.input(message, options?)` — Text input dialog
    - `.password(options?)` — Password dialog
    - `.textDialog(options)` — Monaco editor dialog
    - `.showProgress(promise, label?)` / `.createProgress(label?)` — Progress overlay
    - `.notifyProgress(label, timeout?)` — Progress toast
    - `.addScreenLock()` — Manual screen lock
    - `.notify(message, type?)` — Toast notification
  - **[.shell](./shell.md)** — OS integration
    - `.openExternal(url)` — Open in default browser
    - **[.version](./shell.md#appshellversion)** — Version info
      - `.runtimeVersions()` — Electron/Node/Chrome versions
      - `.checkForUpdates(force?)` — Check for app updates
    - **[.encryption](./shell.md#appshellencryption)** — AES-GCM encryption
      - `.encrypt(text, password)` / `.decrypt(text, password)` / `.isEncrypted(text)`
  - **[.window](./window.md)** — Window management
    - `.minimize()` / `.maximize()` / `.restore()` / `.close()` / `.toggleWindow()`
    - `.isMaximized` / `.windowIndex`
    - `.menuBarOpen` / `.toggleMenuBar()` / `.openMenuBar(panelId?)`
    - `.zoom(delta)` / `.resetZoom()` / `.zoomLevel`
    - `.openNew(filePath?)` — Open new window
  - **[.events](./events.md)** — Event channels for scripting integration
    - **[.fileExplorer](./events.md#fileexploreritemcontextmenu)** — File explorer events
      - `.itemContextMenu` — Right-click on file/folder → add custom menu items
    - **[.browser](./events.md#browseronbookmark)** — Browser events
      - `.onBookmark` — Before Add/Edit Bookmark dialog → modify title, URL, images, category, tags
    - **[.openRawLink](./events.md#openrawlink)** — Layer 1: parse a raw string (path, URL, cURL) into a structured link
    - **[.openLink](./events.md#openlink)** — Layer 2: resolve a URL into a content pipe
    - All channels support `.subscribe()`, `.send()`, and `.sendAsync()`
  - **[.editors](./editors.md)** — Editor registry
    - `.getAll()` / `.getById(id)` / `.resolve(filePath)` / `.resolveId(filePath)`
    - `.getSwitchOptions(languageId, filePath?)`
  - **[.recent](./recent.md)** — Recent files
    - `.files` — Recent file paths (call `.load()` first)
    - `.load()` / `.add(filePath)` / `.remove(filePath)` / `.clear()`
  - **[.downloads](./downloads.md)** — Download tracking
    - `.downloads` / `.hasActiveDownloads` / `.aggregateProgress`
    - `.cancelDownload(id)` / `.openDownload(id)` / `.showInFolder(id)` / `.clearCompleted()`
  - **[.menuFolders](./app.md#menufolders)** — Sidebar folders
    - `.folders` — Current folder list
    - `.add(options)` / `.remove(id)` / `.find(id)` / `.move(sourceId, targetId)`

---

- **[ui](./ui-log.md)** — Log View (lazy-initialized on first access)
  - `await ui()` — Yield to event loop (UI refresh)
  - `.log(msg)` / `.info(msg)` / `.warn(msg)` / `.error(msg)` / `.success(msg)` / `.text(msg)` — Logging
  - `.clear()` — Clear all entries
  - `.preventConsoleLog()` / `.preventConsoleWarn()` / `.preventConsoleError()` — Suppress forwarding
  - **[.dialog](./ui-log.md#dialogs)** — Inline dialogs
    - `.confirm(message, buttons?)` — Confirmation
    - `.buttons(buttons, title?)` — Custom buttons
    - `.textInput(title?, options?)` — Text input
    - `.checkboxes(items, title?, buttons?)` — Multi-select
    - `.radioboxes(items, title?, buttons?)` — Single-select
    - `.select(items, title?, buttons?)` — Dropdown select
  - **[.show](./ui-log.md#progress-bars)** — Rich output
    - `.progress(label?)` — Progress bar → `{value, max, label, completed}`
    - `.grid(data)` — Inline data grid → `{data, columns, title, openInEditor()}`
    - `.text(text, language?)` — Syntax-highlighted block → `{text, language, title, openInEditor()}`
    - `.markdown(text)` — Rendered markdown → `{text, title, openInEditor()}`
    - `.mermaid(text)` — Rendered diagram → `{text, title, openInEditor()}`

---

- **[preventOutput()](../scripting.md#output-suppression)** — Suppress default script output to grouped page
- **[styledText(text)](./ui-log.md#styledtext-global)** — Create styled text builder for dialogs

---

- **[io](./io.md)** — Content pipe builder (providers, transformers, event constructors)
  - `new io.FileProvider(filePath)` — local file data source
  - `new io.HttpProvider(url, options?)` — HTTP/HTTPS data source
  - `new io.ArchiveTransformer(archivePath, entryPath)` — extract an archive entry (ZIP, RAR, 7z, TAR, etc.)
  - `new io.DecryptTransformer(password)` — decrypt AES-GCM content
  - `io.createPipe(provider, ...transformers)` — assemble a content pipe
  - `new io.RawLinkEvent(raw)` — create a Layer 1 raw link event
  - `new io.OpenLinkEvent(url, target?, metadata?)` — create a Layer 2 open link event

---

## Node.js Access

Scripts have full Node.js access via `require()`:

```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
```

## Output

Script return values are written to the grouped (side-by-side) output page:

| Return Type | Output |
|-------------|--------|
| String | Written as-is |
| Number/Boolean | Converted to string |
| Object/Array | JSON formatted |
| Error | Error message + stack trace |
| `undefined` | "undefined" |

See [Scripting Guide](../scripting.md) for full details on running scripts.
