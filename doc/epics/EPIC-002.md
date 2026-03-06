# EPIC-002: App API Polishing

## Status

**Status:** Completed
**Created:** 2026-03-06

## Overview

Systematically test every part of the js-notepad scripting API by running scripts through MCP, verify stability (no exceptions or side effects), and improve the API by adding missing capabilities. The goal is to ensure AI agents have access to as much js-notepad functionality as possible through a reliable, well-tested API.

## Goals

- **Comprehensive testing** — Exercise every method and property of every API surface via MCP `execute_script`
- **Stability verification** — Confirm no unhandled exceptions, no side effects, no crashes
- **Gap identification** — Find missing capabilities that would be useful for AI agents or user scripts
- **API improvements** — Add missing methods, fix broken ones, improve error messages

## Workflow Per Phase

Each phase (1-6) follows the same three-step workflow:
1. **Test existing API** — Run scripts via MCP that exercise every method/property in the API area. Report what works, what throws, what behaves unexpectedly.
2. **Identify missing functionality** — Note gaps in the API that would be useful for AI agents or user scripts.
3. **Implement improvements** — Fix broken methods, add missing functionality, update type definitions and docs. Test the new additions via MCP.

Phase 7 is reserved for **entirely new APIs** that don't fit into existing services (e.g., clipboard, file watching) — discovered during phases 1-6 but too large to fix inline.

## Planned Phases

### Phase 1: Core Services
Test `app.settings`, `app.fs`, `app.shell`, `app.window`, `app.ui`, `app.editors`, `app.recent`, `app.downloads`, `app.menuFolders`.

**app.settings:**
- `theme` (read), `get()`, `set()`, `onChanged` subscription

**app.fs:**
- `read()`, `readFile()`, `readBinary()`, `write()`, `writeBinary()`, `exists()`, `delete()`
- `showOpenDialog()`, `showSaveDialog()`, `showFolderDialog()`
- `resolveDataPath()`, `resolveCachePath()`, `commonFolder()`
- `showInExplorer()`, `showFolder()`

**app.shell:**
- `openExternal()`, `encryption.encrypt()/.decrypt()/.isEncrypted()`, `version.runtimeVersions()/.checkForUpdates()`

**app.window:**
- `minimize()`, `maximize()`, `restore()`, `toggleWindow()`, `isMaximized`
- `menuBarOpen`, `toggleMenuBar()`, `zoom()`, `resetZoom()`, `zoomLevel`
- `openNew()`, `windowIndex`

**app.ui:**
- `confirm()`, `input()`, `password()`, `notify()`

**app.editors:**
- `getAll()`, `getById()`, `resolve()`, `resolveId()`, `getSwitchOptions()`

**app.recent:**
- `load()`, `files`, `add()`, `remove()`, `clear()`

**app.downloads:**
- `downloads`, `hasActiveDownloads`, `aggregateProgress`, `cancelDownload()`, `openDownload()`, `showInFolder()`, `clearCompleted()`, `init()`

**app.menuFolders:**
- `folders`, `add()`, `remove()`, `find()`, `move()`

### Phase 2: Pages Collection
Test `app.pages` — all query, lifecycle, navigation, and layout methods.

**Queries:**
- `activePage`, `groupedPage`, `findPage()`, `getGroupedPage()`, `isLastPage()`, `isGrouped()`

**Lifecycle:**
- `openFile()`, `openFileWithDialog()`, `navigatePageTo()`, `addEmptyPage()`, `addEditorPage()`
- `openDiff()`, `showAboutPage()`, `showSettingsPage()`, `showBrowserPage()`, `openUrlInBrowserTab()`

**Navigation:**
- `showPage()`, `showNext()`, `showPrevious()`

**Layout:**
- `moveTab()`, `pinTab()`, `unpinTab()`, `group()`, `ungroup()`

### Phase 3: Page Object
Test `page` properties and basic operations.

**Read-only:** `id`, `type`, `title`, `modified`, `pinned`, `filePath`, `data`
**Read-write:** `content`, `language`, `editor`
**Grouped pages:** `page.grouped` — auto-creation, content, language, editor

### Phase 4: Text & Grid Facades
Test `page.asText()` and `page.asGrid()`.

**ITextEditor:**
- `editorMounted`, `getSelectedText()`, `revealLine()`, `setHighlightText()`, `getCursorPosition()`, `insertText()`, `replaceSelection()`

**IGridEditor:**
- `rows`, `columns`, `rowCount`, `editCell()`, `addRows()`, `deleteRows()`, `addColumns()`, `deleteColumns()`, `setSearch()`, `clearSearch()`

### Phase 5: Content Editor Facades
Test `page.asNotebook()`, `page.asTodo()`, `page.asLink()`.

**INotebookEditor:**
- `notes`, `categories`, `tags`, `notesCount`, `addNote()`, `deleteNote()`, `updateNoteTitle()`, `updateNoteContent()`, `updateNoteCategory()`, `addNoteTag()`, `removeNoteTag()`

**ITodoEditor:**
- `items`, `lists`, `tags`, `addItem()`, `toggleItem()`, `deleteItem()`, `updateItemTitle()`, `addList()`, `renameList()`, `deleteList()`, `addTag()`

**ILinkEditor:**
- `links`, `categories`, `tags`, `linksCount`, `addLink()`, `deleteLink()`, `updateLink()`

### Phase 6: Preview & Browser Facades
Test `page.asMarkdown()`, `page.asSvg()`, `page.asHtml()`, `page.asMermaid()`, `page.asBrowser()`.

**IMarkdownEditor:** `viewMounted`, `html`
**ISvgEditor:** `svg`
**IHtmlEditor:** `html`
**IMermaidEditor:** `svgUrl`, `loading`, `error`
**IBrowserEditor:** `url`, `title`, `navigate()`, `back()`, `forward()`, `reload()`

### Phase 7: New APIs (Skipped)
No new API surfaces were identified as urgently needed during phases 1-6. The only gap found (4 missing Todo facade methods) was fixed inline during Phase 5. Candidates like Clipboard API, page event subscriptions, and file watching remain in the backlog for future consideration.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-108 | Test & Improve app.fs API | Done |
| US-109 | Test & Improve app.shell API | Done |
| US-110 | Test & Improve app.window API | Done |
| US-111 | Test & Improve app.ui API | Done |
| US-112 | Test & Improve app.editors API | Done |
| US-113 | Test & Improve app.recent API | Done |
| US-114 | Test & Improve app.downloads API | Done |
| US-115 | Test & Improve app.settings API | Done |
| US-116 | Test & Improve app.menuFolders API | Done |
| US-118 | Phase 2: Test Pages Collection API | Done |
| US-119 | Phase 3: Test Page Object API | Done |
| US-120 | Phase 4: Test Text & Grid Facades | Done |
| US-121 | Phase 5: Test Content Editor Facades | Done |
| US-122 | Phase 6: Test Preview & Browser Facades | Done |

## Notes

### 2026-03-06
- Epic created after completing EPIC-001 (AI Claude Integration)
- All testing will be done via MCP `execute_script` tool — dogfooding the MCP integration
- Phase 7 scope depends entirely on what phases 1-6 discover
- Phases 1-6 completed: all APIs tested, 4 Todo facade methods added (US-121), no other gaps found
- Phase 7 skipped — no new API surfaces needed. Epic completed.
