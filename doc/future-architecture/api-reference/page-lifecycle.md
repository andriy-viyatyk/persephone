# Page Lifecycle

Describes the complete lifecycle of a page (`IPage`) — from creation to disposal. Understanding this lifecycle is essential for deciding where new functionality hooks in and what events scripts/AI can listen to.

**Implementation:** [`/src/renderer/api/pages/`](../../src/renderer/api/pages/) — see also [/doc/architecture/pages-architecture.md](../../architecture/pages-architecture.md) for diagrams and submodel overview.

---

## Lifecycle States

```
                        ┌──────────────────────────────────┐
                        │                                  │
  ┌──────────┐    ┌─────▼─────┐    ┌──────────┐    ┌──────┴─────┐
  │ Creating  ├───►│  Restoring ├───►│  Active   ├───►│  Closing   │
  └──────────┘    └───────────┘    └─────┬─────┘    └──────┬─────┘
                                         │                 │
                                    ┌────▼────┐     ┌──────▼─────┐
                                    │ Saving   │     │  Disposed  │
                                    └────┬────┘     └────────────┘
                                         │
                                    ┌────▼──────────┐
                                    │ Moving to      │
                                    │ other window   │
                                    └───────────────┘
```

---

## 1. Creating

A page model is instantiated. No file access, no watchers — just object construction.

**Entry points:**

| How | Method | Creates |
|-----|--------|---------|
| Open file | `pagesModel.openFile(path)` → `page-factory.newPageModel(path)` | Model matched by editor registry |
| New empty page | `pagesModel.addEmptyPage()` → `page-factory.newEmptyPageModel()` | Empty TextFileModel |
| New editor page | `pagesModel.addEditorPage(editor)` → `page-factory.newEditorPageModel()` | Browser, About, Settings, etc. |
| App startup restore | `pagesModel.restoreState()` → `page-factory.newPageModelFromState(data)` | Model from cached state |
| Received from window | `pagesModel.movePageIn(data)` → `page-factory.newPageModelFromState(data)` | Model from transferred state |

**What happens:**
1. Editor registry resolves the editor definition (for file-based creation)
2. Editor module is lazy-loaded via `import()` — code splitting preserved
3. Model constructor runs — state initialized with defaults, ID assigned
4. **No file reading, no watchers, no cache access yet**

**Events:** None.

---

## 2. Restoring

The model loads its content and initializes watchers. This is the async initialization step.

**Trigger:** `page.restore()` called after construction.

**What happens (TextFileModel):**
1. **File watcher created** — `FileWatcher(filePath, onFileChanged)` starts `fs.watchFile`
2. **Content loaded** — one of:
   - Modified + cached: read content from disk cache (`cache/{pageId}.txt`)
   - Not modified + has path: read from actual file on disk
   - No path (new empty page): use empty string
3. **Language detected** — from file extension
4. **Encoding detected** — from file content (BOM sniffing)
5. **Script panel restored** — script cache loaded from disk
6. **Navigation panel restored** — if `hasNavPanel` was true
7. State marked `restored = true`

**What happens (BrowserPageModel):**
1. Profile and bookmarks loaded
2. URL state restored
3. Tab list restored

**What happens (Other editors: Grid, Notebook, Todo, Links):**
1. Content parsed from text state
2. Component state restored from cache (column widths, selections, etc.)

**Events:** State change fires (content populated, language set, etc.)

---

## 3. Attaching (to Pages Collection)

After restore, the page is added to the workspace.

**What happens:**
1. `pagesModel.attachPage(page)` — subscribes to page state changes
2. Page added to `pages[]` and `ordered[]` arrays
3. `page.onClose` callback set — wires close to detach+dispose
4. Window state saved to disk (page list updated)
5. If opened from file: `recentFiles.add(filePath)` called

**Events:**
- `pagesModel.onShow` — if page becomes active immediately
- `pagesModel.onFocus` — same

**Proposed new events for IPageCollection:**
- `onPageOpened(page)` — fires after page is attached and ready
- `onActiveChanged(page)` — fires when active page changes

---

## 4. Active (Normal Operation)

The page is open and the user interacts with it. This is the main lifecycle state.

### Content Editing

1. User types → Monaco fires change → `page.changeContent(newContent, byUser: true)`
2. State updated: `content`, `modified = true`, `temp = false`
3. **Debounced cache save (1000ms):** unsaved content written to `cache/{pageId}.txt`
4. **Debounced window state save (500ms):** page list + metadata written to data file

### File Monitoring

`FileWatcher` uses `fs.watchFile()` with debounced callbacks (300ms):

- **File changed on disk, page NOT modified locally:** Auto-reload content from disk
- **File changed on disk, page IS modified locally:** Do nothing (user's edits preserved)
- **File deleted on disk:** Mark `state.deleted = true`, set `modified = true`

### Language / Editor Changes

- `page.changeLanguage(lang)` — updates language, validates current editor is compatible
- `page.changeEditor(editor)` — switches view (e.g., monaco → grid-json), validates for language

### Grouping

Two pages can be displayed side-by-side:
- `pagesModel.group(leftId, rightId)` — creates grouping in `leftRight`/`rightLeft` maps
- `pagesModel.ungroup(pageId)` — removes grouping
- Grouping is metadata on pagesModel, not on the page itself
- Persisted in window state cache
- If a grouped page is closed, the grouping is automatically cleaned up

### Navigation Panel

Optional file browser panel attached to a page:
- Created on demand when user opens nav panel
- Persisted: `hasNavPanel` flag saved in page state
- Restored on app startup
- Disposed with the page

**Events during Active state:**
- State change subscriptions (any property change)
- FileWatcher callbacks (file changed/deleted on disk)

**Proposed new events for IPage:**
- `onContentChanged(content)` — after content is set (by user or programmatically)
- `onModifiedChanged(modified)` — when dirty flag toggles
- `onLanguageChanged(language)` — language mode changed
- `onEditorChanged(editor)` — view type switched
- `onFileChanged()` — underlying file changed on disk

---

## 5. Saving

Save writes content to disk and resets the modified flag.

**Trigger:** `page.saveFile()` or `page.saveAs(newPath)`

**What happens:**
1. Content transformed for save (encrypt if encrypted file)
2. `filesModel.saveFile(path, content, encoding)` — writes to disk
3. `filesModel.deleteCacheFile(pageId)` — remove unsaved content cache
4. State updated: `modified = false`, `filePath = newPath` (if save as), `temp = false`
5. **File watcher recreated** for new path (if save as):
   - Old watcher disposed
   - New watcher created with new path
6. `recentFiles.add(newPath)` — update recent files

**Events:**
- State change (modified → false)

**Proposed new event for IPage:**
- `onSaved(filePath)` — after successful save

---

## 6. Closing

User closes the page (close button, Ctrl+W, close all, etc.)

**Flow:**
```
page.close()
  → canClose?()
    → If modified && not temp:
      → Show "Save changes?" dialog
        → Save: saveFile() first, then close
        → Don't Save: close without saving
        → Cancel: abort close
  → If canClose returns true:
    → onClose() callback fires
      → pagesModel.detachPage(page)
        → Unsubscribe from state changes
      → pagesModel.removePage(page)
        → Remove from pages[] and ordered[]
        → fixGrouping() — remove broken groupings
        → fixCompareMode() — disable compare if ungrouped
        → saveState() — persist to cache
        → If was active: activate previous page
        → checkEmptyPage() — create new empty if workspace empty
      → page.dispose()
```

**Dispose cleanup order (TextFileModel):**
1. `fileWatcher.dispose()` — stop `fs.watchFile` listener
2. `editor.onDispose()` — Monaco editor instance cleanup
3. `script.dispose()` — script panel cleanup
4. `navPanel?.dispose()` — navigation panel cleanup
5. `filesModel.deleteCacheFiles(id)` — remove ALL cache files for this page

**Other page types dispose:**
- **BrowserPageModel:** Clear HTTP cache, dispose bookmarks model, unsubscribe keyboard events
- **GridPageModel:** Unsubscribe from state changes
- **Link/Todo/Notebook editors:** Unsubscribe from state listeners

**Events:**
- `pagesModel.onShow(previousPage)` — if active page changed after close

**Proposed new events:**
- `page.onClosing()` — before close begins (can be used for cleanup)
- `pagesModel.onPageClosed(page)` — after page is fully disposed

---

## 7. Moving Between Windows

A page can be transferred to another js-notepad window (drag to external, or "Move to new window").

### Sending (movePageOut)

1. `page.saveState()` — flush all caches
2. `page.skipSave = true` — prevent re-save during dispose
3. `page.getRestoreData()` — serialize state (id, type, filePath, language, editor, pinned, etc.)
4. If last page in window: close the window
5. Otherwise: `detachPage(page)` + `removePage(page)` — **dispose is NOT called**
6. Serialized data sent to target window via IPC

**Key detail:** The page model is detached but NOT disposed. Cache files remain on disk for the receiving window to use.

### Receiving (movePageIn)

1. `newPageModelFromState(data)` — create model from serialized state
2. `applyRestoreData(data)` — populate state from transferred data
3. `page.restore()` — full restore (file watchers, content load, cache load)
4. `pagesModel.attachPage(page)` — subscribe and add to workspace
5. If target position specified: insert at position; otherwise append

**Key detail:** FileWatchers are recreated from scratch in the new window. The page gets a fresh connection to the file system.

**Proposed new events:**
- `pagesModel.onPageMovedOut(page)` — before page leaves this window
- `pagesModel.onPageMovedIn(page)` — after page arrives in this window

---

## 8. App Quit

When the application is closing (user closes window, system shutdown, etc.)

**Flow:**
1. `rendererEvents.eBeforeQuit` fires
2. `pagesModel.onAppQuit()` handles:
   - `Promise.all(pages.map(p => p.saveState()))` — save all pages in parallel
     - TextFileModel: flush unsaved content to cache, flush nav panel
     - Other models: flush their specific caches
   - `pagesModel.saveState()` — save window state (page list, groupings, active page)
3. `api.setCanQuit(true)` — signal main process that renderer is ready

**Key detail:** Pages are NOT disposed on quit — their state is saved for restoration on next launch. Disposing would delete cache files that are needed for restore.

---

## Summary: What Happens at Each Transition

| Transition | File Watcher | Cache | State | Subscriptions |
|------------|-------------|-------|-------|---------------|
| Created | — | — | Defaults | — |
| Restoring | Created | Read | Populated | — |
| Attached | Running | — | — | Added |
| Content edited | Running | Written (debounced) | Updated | Active |
| File changed on disk | Triggers callback | — | May reload | Active |
| Saved | Recreated (if new path) | Deleted | `modified = false` | Active |
| Grouped/Ungrouped | Unchanged | — | — | Unchanged |
| Moving out | Stopped (detach) | Preserved | Serialized | Removed |
| Moving in | Created (fresh) | Read | Restored | Added |
| Closing | Stopped | Deleted | — | Removed |
| App quit | Running | Flushed | Saved | Running |

---

## Proposed Lifecycle Events (for IPage and IPageCollection)

Events that scripts and AI agents can subscribe to:

### IPageCollection events

```typescript
interface IPageCollection {
  onPageOpened: IEvent<IPage>;              // Page added to workspace and ready
  onPageClosed: IEvent<IPage>;             // Page removed and disposed
  onActiveChanged: IEvent<IPage | null>;   // Active page switched
  onPageMovedOut: IEvent<IPage>;           // Page leaving this window
  onPageMovedIn: IEvent<IPage>;            // Page arrived from another window
}
```

### IPage events

```typescript
interface IPage {
  onContentChanged: IEvent<string>;         // Content was set
  onModifiedChanged: IEvent<boolean>;       // Dirty flag toggled
  onLanguageChanged: IEvent<string>;        // Language mode changed
  onEditorChanged: IEvent<string>;          // View type switched
  onSaved: IEvent<string>;                  // File saved (path)
  onFileChanged: IEvent<void>;              // Underlying file changed on disk
  onClosing: IEvent<void>;                  // About to close
}
```

These events enable reactive scripts (e.g., "format on save", "auto-lint on language change") and give AI agents visibility into what the user is doing.
