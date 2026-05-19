# 05 — Multi-window transfer walkthrough

Scope: dragging a tab between two open windows (or out into a brand-new window). The IPC payload shape under the new architecture, the source-side flush-then-detach ordering, the target-side restore call, per-editor cache file survival across the transfer, and the relation to bootstrap restore from walkthrough 04.

**Out of scope** (own walkthroughs): bootstrap restore (`04`), compare mode (`06`), grouped pages (`07`), open-in-new-window of a fresh file (handled by `openPathInNewWindow` — not a transfer), MCP `open_window` flow (`13`).

**Status:** Done (2026-05-19). All concerns M1–M10 resolved. Mockups updated: `editorRegistry.ts` (C1 — `instanceId` comment expanded to cover IPC transfer alongside session restore), `PageModel.ts` (C2 — `saveState()` comment lists both callers: `handleBeforeQuit` and `movePageOut`). C3 (`restorePage` promoted to public method on `PagesPersistenceModel`) logged for real-code implementation — no mockup file change since `PagesPersistenceModel.ts` isn't a foundation mockup.

---

## What exists today

### Three-stage IPC dance

A tab drag that crosses windows traverses both renderer processes and the main process. The path:

1. **Source renderer (`PageTab.tsx`):**
   - `handleDragStart` writes `application/persephone-tab` data (a JSON-serialized `PageDragData` built by `getDragData()`). Pinned tabs skip this — they can't be cross-window-dragged.
   - `handleDragEnd` detects "dropped outside any window" via `e.clientX/Y` out-of-range, then calls `api.addDragEvent(dropData)` with `dropPosition: {x: e.screenX, y: e.screenY}` (no `targetWindowIndex` — a new window is implied).
   - `handleDrop` detects a foreign-window drag arriving (different `sourceWindowIndex`) and calls `api.addDragEvent(this.getDragData(true))` with `targetWindowIndex` and the local target tab id.

2. **Main process (`drag-model.ts`):**
   - Buffers events for 100ms via setTimeout — gives the matching source-side `dragEnd` and target-side `drop` time to both arrive.
   - On flush, picks the latest `sourceWindowIndex`/`targetWindowIndex`/`page`/`dropPosition`/`targetPageId` from the buffer, calls `openWindows.movePageToWindow(sourceWindowIndex, targetWindowIndex, page, targetPageId, dropPosition)`.

3. **Main process (`open-windows.ts`):**
   - `movePageToWindow`:
     - Sends `eMovePageOut` with `page.id` to source window (source clears its copy).
     - If target window doesn't exist, creates it (with `dropPosition`).
     - Awaits target's `whenReady`, then sends `eMovePageIn` with `{page, targetPageId}`.

### Renderer dispatch (both sides)

`RendererEventsService.ts:21-22, 59-73`:
```ts
rendererEvents.eMovePageIn.subscribe(this.handleMovePageIn);
rendererEvents.eMovePageOut.subscribe(this.handleMovePageOut);

private handleMovePageIn = async (data: any) => {
    try {
        await pagesModel.movePageIn(data);
    } catch (err) {
        ui.notify(`Failed to move page: ${err.message}`, "error");
    }
};

private handleMovePageOut = async (pageId: string) => {
    try {
        await pagesModel.movePageOut(pageId);
    } catch (err) { ui.notify(...); }
};
```

### Source-side `movePageOut` (today)

`PagesLifecycleModel.ts:632-650`:
```ts
movePageOut = async (pageId?: string) => {
    const page = this.model.query.findPage(pageId);
    if (!page) return;

    await page.saveState();                       // flush sidebar cache file + main editor cache
    const closeWindow = this.model.state.get().pages.length === 1;

    if (closeWindow) {
        this.model.state.update((s) => {
            s.pages = s.pages.filter((p) => p !== page);
            s.ordered = s.ordered.filter((p) => p !== page);
        });
        this.model.persistence.saveStateDebounced();   // remove from openFiles.txt
        api.closeWindow();                              // last page → kill window
    } else {
        this.model.detachPage(page);                   // unsubscribe ONLY
        this.model.removePage(page);                   // splice from arrays
    }
};
```

`page.saveState()` does two things (`PageModel.ts:592-594`):
```ts
async saveState(): Promise<void> {
    await this._saveState();                  // writes <pageId>-nav-panel.txt
    await this.mainEditor?.saveState();       // writes <editorId>-host.txt etc.
}
```

**Critical: `removePage` does NOT call `page.dispose()`.** `PagesModel.ts:110-126`:
```ts
removePage = (page: PageModel) => {
    // …splice from pages[]/ordered…
    this.layout.fixGrouping();
    this.persistence.saveState();
    // no dispose() — the page survives in IPC payload + target window
};
```

Only `page.onClose` (set inside `attachPage` `PagesModel.ts:77-81`) calls `page.dispose()` — and `detachPage` clears `onClose` (`PagesModel.ts:107`). So after `detachPage + removePage`, the original `page` object becomes garbage (no references in source model), but its editor's cache files on disk survive untouched.

### Target-side `movePageIn` (today)

`PagesLifecycleModel.ts:589-630`:
```ts
movePageIn = async (data?: { page: PageDescriptor; targetPageId: string | undefined }) => {
    if (!data?.page) return;

    const desc = data.page;
    const page = new PageModel(desc.id);                    // page.id continuity
    page.pinned = desc.pinned ?? false;

    if (desc.editor && Object.keys(desc.editor).length > 0) {
        const editor = await this.newEditorModelFromState(desc.editor);  // class lookup via type/editor fields
        editor.applyRestoreData(desc.editor);                            // editor.id continuity (inside desc.editor)
        await editor.restore();                                          // reads <editor.id>-host.txt (source already wrote)
        page.mainEditor = editor;
        editor.setPage(page);
    }

    if (desc.hasSidebar) {
        await page.restoreSidebar();                        // reads <pageId>-nav-panel.txt
        await page.restoreSecondaryEditors(page.mainEditor ?? null);
    }

    const targetIndex = data.targetPageId
        ? this.model.state.get().pages.findIndex((p) => p.id === data.targetPageId)
        : -1;

    if (targetIndex === -1) {
        this.addPage(page.mainEditor, page);
        this.model.closeFirstPageIfEmpty();
    } else {
        this.model.attachPage(page);
        this.model.state.update((s) => {
            s.pages.splice(targetIndex, 0, page);
            s.ordered.push(page);
        });
        this.model.layout.fixGrouping();
        this.model.persistence.saveStateDebounced();
    }
};
```

### Drag payload shape (today)

`PageTab.tsx:419-433` — `getDragData()`:
```ts
private getDragData = (drop = false): PageDragData => {
    const page = this.props.model;
    const editor = page.mainEditor;
    return {
        sourceWindowIndex: drop ? undefined : appWindow.windowIndex,
        targetWindowIndex: drop ? appWindow.windowIndex : undefined,
        page: {
            id: page.id,
            pinned: page.pinned,
            modified: page.modified,
            hasSidebar: page.hasSidebar,
            editor: editor?.getRestoreData() ?? {},     // Partial<IEditorState>
        },
    };
};
```

`PageDescriptor` (today's shape, `src/shared/types.ts:23-34`) carries `editor: Partial<IEditorState>` + `hasSidebar: boolean`. The IPC payload IS the same `PageDescriptor` used by persistence.

### Implicit invariants worth preserving

| Invariant | Why it holds |
|-----------|--------------|
| Page ID survives transfer | Target's `new PageModel(desc.id)` reuses the source ID; cache files (`<pageId>-*`) keep working — though after walkthrough 04 there are none left at the page level |
| Editor ID survives transfer | Carried inside `desc.editor.id`; target's `applyRestoreData` restores it before `restore()` reads cache files |
| Per-editor cache files survive transfer | `removePage` doesn't `dispose()`; editor cache files (`<editor.id>-host.txt` etc.) are untouched on disk during transfer |
| Sidebar cache survives transfer | Source's `page.saveState()` flushes `<pageId>-nav-panel.txt` BEFORE `eMovePageOut` returns; target's `restoreSidebar()` reads after `eMovePageIn` |
| Source window closes if it had only the moved page | `closeWindow` branch in `movePageOut` |
| Drop position drives new-window placement | `dropPosition` plumbed through `createWindow` in `open-windows.ts:33` |
| Pinned tabs can't cross-window-drag | `handleDragStart` skips the `application/persephone-tab` dataTransfer for pinned; `handleDragEnd` early-returns on pinned |
| Tab-reorder vs. window-transfer disambiguated | `handleDrop` checks `application/persephone-tab` first (cross-window has priority); falls back to `TraitTypeId.PageTab` for in-window reorder |
| 100ms event buffer in main process | `drag-model.ts` waits for both `dragEnd` and `drop` to arrive, so the same drag emits one consolidated `movePageToWindow` call |

---

## What the new architecture needs to support

After walkthroughs 01–04, the architecture commits to:

- **`PageDescriptor` shape** (walkthrough 04 / C1) — `{ id, pinned, modified, mainEditorId, editors[], sidebar? }`. Flat `editor` field and `hasSidebar` boolean both gone.
- **`EditorDescriptor` shape** (walkthrough 04 / C1) — `{ editorId, id, state, host? }`.
- **`editorRegistry.createEditor(editorId, instanceId?)`** (walkthrough 04 / C2) — when `instanceId` is supplied, the new editor reuses that UUID. This is THE mechanism that preserves per-editor cache file continuity across both bootstrap restore and IPC transfer.
- **Three-phase editor lifecycle** (walkthrough 01) — `createEditor → applyRestoreData → restore`. Host construction is fully inside `restore()`.
- **No sidebar cache file** (walkthrough 04 / P3) — sidebar metadata (`open`, `width`, `activePanel`) lives inside `PageDescriptor.sidebar`. Page-level cache file (`<pageId>-nav-panel.txt`) is gone. Per-editor cache files (`<editor.id>-*`) remain.
- **`PageModel.saveState()`** (walkthrough 04 / C7) — `Promise.all(editors.map(e => e.saveState?.()))`. No sidebar cache flush; per-editor flushes only.
- **`PagesPersistenceModel.restorePage(desc)`** (walkthrough 04 / C5) — single helper that turns one `PageDescriptor` into a fully wired `PageModel`. Today's flow is split between bootstrap restore (`PagesPersistenceModel.restoreState`) and IPC transfer (`movePageIn`).

Functional requirements for multi-window transfer (no regressions vs. today):

1. **IPC payload is the new `PageDescriptor`.** No legacy fields (`hasSidebar`, `editor: Partial<IEditorState>`).
2. **Editor-id continuity across the transfer.** `EditorDescriptor.id` rides in the payload; target reuses it as `instanceId` to `createEditor`. Per-editor cache files survive.
3. **Page-id continuity across the transfer.** Target's `restorePage(desc)` creates `new PageModel(desc.id)`. Page id stays constant for any external observer holding the id (e.g., page-id-based features).
4. **Source flushes per-editor caches before detach.** `await page.saveState()` (walkthrough 04 / C7 — iterates `editors[]`) so target's `editor.restore()` reads up-to-date content. No sidebar cache file to coordinate.
5. **Source detaches without disposing.** Same invariant as today; explicitly stated in PagesModel after walkthrough 01.
6. **Sidebar metadata transfers in the payload.** Target's `restorePage` applies `desc.sidebar` (open/width/activePanel) after all editors are attached.
7. **Per-editor restore failure salvages siblings.** Walkthrough 04 / P7 already specifies this — applies equally to IPC transfer.
8. **Last-page-in-source-window-closes-source-window.** Same behavior as today.

---

## How the foundation mockups handle this

Already in place after walkthroughs 01–04:

- `PersistenceTypes.ts` — `PageDescriptor` / `EditorDescriptor` shapes used as the IPC payload type (same as the persistence type).
- `editorRegistry.createEditor(id, instanceId?)` — preserves editor.id at construction (walkthrough 04 / C2). This is the workhorse of transfer cache-survival.
- `PageModel.saveState()` — `Promise.all(editors.map(e => e.saveState?.()))` (walkthrough 04 / C7). Called by `movePageOut` to flush before detach.
- `PageModel.attach/detach` (walkthrough 01) — `attach` wires `descriptorChanged` subs; `detach` tears them down. `removePage` (real code) splices from arrays without dispose. Transfer-friendly out of the box.
- `EditorModel.descriptorChanged` (walkthrough 01 / A6) — already routes editor mutations to `PagesPersistenceModel.saveStateDebounced` via the per-editor subscription.

What walkthrough 05 must add or commit to:

- **`PageDragData` shape update** — `page: PageDescriptor` already a typed reference; the type rewrite happens in walkthrough 04 (C1) but the rename to new-shape fields propagates to drag code (`PageTab.getDragData()`, `dragModel.processedEvents`).
- **`movePageIn` rewrite** — delegate to `PagesPersistenceModel.restorePage(desc)` (shared with bootstrap restore). Keep target-index splice logic local.
- **`movePageOut` rewrite** — minor cleanup; `await page.saveState()` (still relevant, just no sidebar file anymore), then detach/remove.
- **`PagesPersistenceModel.restorePage`** — promote from private (walkthrough 04 / C5 sketch) to a method callable by `movePageIn`. No change to internal logic.

No new mockup files. Minor comment touches in `PageModel.ts` and `editorRegistry.ts` mockups to flag the dual use.

---

## Concerns surfaced (transfer-specific)

Each concern presented with the problem, options on the table, and a **proposed** decision (subject to review).

### M1 — IPC payload shape — **RESOLVED 2026-05-19**

**Problem.** Today's `PageDragData.page` is the flat `PageDescriptor` (with `editor: Partial<IEditorState>` + `hasSidebar`). After walkthrough 04, `PageDescriptor` is `{ id, pinned, modified, mainEditorId, editors[], sidebar? }`. The IPC payload follows.

**Proposed:** `PageDragData.page` stays typed as `PageDescriptor`. The shape change is automatic — walkthrough 04 rewrites `PageDescriptor`, the drag payload picks up the new type at compile time. No `schemaVersion` on the drag payload — both windows run the same process version; the schema discriminator lives at the file level (openFiles.txt), not at the IPC-message level.

**Options considered.**
- (a) Add `schemaVersion: 4` to `PageDragData` for parity with persistence. Rejected — unnecessary inside a single app instance; both renderers run the same code.
- **(b) — chosen.** Just propagate the new `PageDescriptor` shape; no version field on the drag payload.

### M2 — Unify IPC restore with bootstrap restore — **RESOLVED 2026-05-19**

**Problem.** Today's `movePageIn` reimplements page restore (creates `PageModel`, looks up editor class via `newEditorModelFromState`, calls `applyRestoreData` + `restore`, restores sidebar via the old per-page cache file flow). After walkthrough 04, `PagesPersistenceModel.restorePage(desc)` is the canonical path. The two flows have identical inputs (a `PageDescriptor`) and produce identical outputs (a wired `PageModel`).

**Proposed:** Promote `restorePage(desc)` to a method that both bootstrap restore AND `movePageIn` call. `movePageIn` becomes:

```ts
movePageIn = async (data?: { page: PageDescriptor; targetPageId?: string }) => {
    if (!data?.page) return;
    const page = await this.model.persistence.restorePage(data.page);
    if (!page) return;                          // P7 salvage rules — all editors failed + no sidebar

    const targetIndex = data.targetPageId
        ? this.model.state.get().pages.findIndex((p) => p.id === data.targetPageId)
        : -1;
    if (targetIndex === -1) {
        this.addPage(page.mainEditor, page);
        this.model.closeFirstPageIfEmpty();
    } else {
        this.model.attachPage(page);
        this.model.state.update((s) => {
            s.pages.splice(targetIndex, 0, page);
            s.ordered.push(page);
        });
        this.model.layout.fixGrouping();
        this.model.persistence.saveStateDebounced();
    }
};
```

Convergence benefits:
- Same per-editor `console.warn + continue` salvage (walkthrough 04 / P7) on IPC transfer.
- Same parallel-restore-then-resolve-activePanel ordering (walkthrough 04 / P5).
- Same `editorRegistry.createEditor(id, instanceId)` cache continuity (walkthrough 04 / C2 / P6).
- One less hand-maintained restore path.

**Options considered.**
- (a) Keep two separate paths (bootstrap vs. IPC). Rejected — pure duplication; the two paths' inputs are identical.
- **(b) — chosen.** Single `restorePage(desc)` consumed by both.

### M3 — Source-side flush ordering — **RESOLVED 2026-05-19**

**Problem.** Today's `movePageOut` calls `await page.saveState()` before detach to flush both the sidebar cache file AND the main editor's cache. After walkthrough 04 the sidebar cache file is gone, but per-editor caches still exist and still need flushing for the target to read up-to-date content.

**Proposed:** Keep `await page.saveState()` in `movePageOut`. The call is now lighter — only per-editor flushes, no sidebar file write — but the ordering invariant (flush completes before IPC send) stays critical.

```ts
movePageOut = async (pageId?: string) => {
    const page = this.model.query.findPage(pageId);
    if (!page) return;

    await page.saveState();                       // flush per-editor caches (was: + sidebar cache, gone in 04)
    const closeWindow = this.model.state.get().pages.length === 1;

    if (closeWindow) {
        this.model.state.update((s) => {
            s.pages = s.pages.filter((p) => p !== page);
            s.ordered = s.ordered.filter((p) => p !== page);
        });
        this.model.persistence.saveStateDebounced();
        api.closeWindow();
    } else {
        this.model.detachPage(page);
        this.model.removePage(page);
    }
};
```

`page.saveState()` body (already in walkthrough 04 / C7):
```ts
async saveState(): Promise<void> {
    await Promise.all(this.editors.map((e) => e.saveState?.()));
}
```

Each `EditorModel` subclass's `saveState?()` must flush its own internal debounce. **Invariant** logged for editor walkthroughs 20–30: `saveState()` is an awaitable flush, not a fire-and-forget save.

**Options considered.**
- (a) Drop `await page.saveState()` — rely on each editor's debounced auto-save firing eventually. Rejected — debounced writes may not have run between the last edit and the drag; target would read stale content.
- **(b) — chosen.** Keep the await. Source guarantees a flush completes before IPC send.

### M4 — Detach-without-dispose invariant — **RESOLVED 2026-05-19**

**Problem.** Cache-file survival across transfer depends entirely on `removePage(page)` not calling `page.dispose()`. If it did, `editor.dispose()` runs (walkthrough 04 mockup, `EditorModel.dispose → fs.deleteCacheFiles(this.id)`), and the target reconstructs an empty editor.

Today's invariant holds because `removePage` only does `state.update` + `fixGrouping` + `persistence.saveState` + `checkEmptyPage` — no `dispose()`. The `dispose()` call lives on `page.onClose`, set by `attachPage` and cleared by `detachPage`.

**Proposed:** Make the invariant explicit. Add a comment to `removePage` in PagesModel mockup (or in the implementation when it's rewritten):

```ts
removePage = (page: PageModel) => {
    // NOTE: Does NOT call page.dispose() — `movePageOut` relies on this to keep
    // per-editor cache files alive on disk. The detached page becomes garbage
    // in source memory, but its cache files survive for target to read.
    // Closing a tab calls dispose via attachPage's `onClose`, set up there.
    // …existing splice/fixGrouping/saveState/checkEmptyPage…
};
```

No code change — pure documentation. The behavior is already correct.

**Options considered.**
- (a) Refactor `removePage` to take a `{ dispose: boolean }` flag for explicit intent. Rejected — over-design; the existing `detachPage` clears `onClose` precisely to express "don't dispose this." The shape is fine; it just needs a comment.
- **(b) — chosen.** Comment-only.

### M5 — Editor-id continuity (cache-file survival) — **RESOLVED 2026-05-19**

**Problem.** Per-editor cache files are keyed on `editor.id`. Across transfer:
- Source: `getRestoreData()` includes `id` in the descriptor.
- Target: must instantiate the editor with the same `id`, OR cache files become orphaned and the target reads from nowhere.

After walkthrough 04 / C2, this is handled by `editorRegistry.createEditor(editorId, instanceId?)`. The bootstrap restore path passes `desc.id` as `instanceId`. IPC transfer (via `restorePage` from M2) shares this path.

**Proposed:** No new mechanism. Confirm the existing one. Two invariants:

1. `getRestoreData()` MUST include the editor's `id` (already the case in walkthrough 04 / C3 — `EditorDescriptor.id`).
2. `restorePage(desc)` MUST pass `d.id` as `instanceId` to `createEditor` (already the case in walkthrough 04 / C5 sketch).

`editorRegistry.ts` mockup gets a comment clarifying that `instanceId` is used by both bootstrap restore AND IPC transfer (walkthrough 05).

**Options considered.**
- (a) Embed full host-content blob in the IPC payload (avoid the cache-file dependency). Rejected — content blobs can be megabytes; bloats IPC; defeats walkthrough 04's cache-file design.
- **(b) — chosen.** Editor-id continuity via `instanceId`. Cache files stay on disk, target reads them via `editor.restore()`.

### M6 — Multi-editor transfer (panel-contributors) — **RESOLVED 2026-05-19**

**Problem.** Today's `movePageIn` separately restores main + secondaries (the secondaries via `restoreSecondaryEditors`, which reads the sidebar cache file). After walkthrough 04, `editors[]` carries all of them in one array. Transfer of a page with a sidebar (Link, Todo, Rest, Archive, Notebook) means transferring N editors atomically.

**Proposed:** No new logic needed. `restorePage(desc)` (walkthrough 04 / P5) already restores all editors in parallel via `Promise.all`, then applies `mainEditorId` + `sidebar`. Both IPC and bootstrap consume the same code.

Per-editor failure (walkthrough 04 / P7) salvages siblings — target may end up with a transferred page missing one panel-contributor whose class failed to load. Same behavior as today's `restoreSecondaryEditors` catch.

**Options considered.**
- (a) Atomicity: target rejects the transfer if ANY editor fails to restore. Rejected — over-eager; loses sibling state. Inconsistent with walkthrough 04 / P7 stance.
- **(b) — chosen.** Per-editor salvage, same as bootstrap.

### M7 — Source window goes empty (single-page window) — **RESOLVED 2026-05-19**

**Problem.** When the source window had only the dragged page, `closeWindow` flag fires the source's `api.closeWindow()` after persisting the empty state.

**Proposed:** Logic unchanged from today. Source window's openFiles.txt updates to empty `pages: []` (with `schemaVersion: 4` per walkthrough 04 / C6). Next time the source window starts (or is restored from its slot), it would normally trigger `checkEmptyPage` → `addEmptyPage`. But since the window closes immediately, that branch doesn't fire — the closed window slot persists in `openWindows.json` until the user fully quits.

**Edge case** — what if the source window is window-index 0 (the main window)? Hiding it instead of closing would be more friendly; today's `setCanQuit` (`open-windows.ts:88-106`) already handles "last window hides instead of closes." Confirm this still works after walkthrough 04 with no changes — it does, because the hide/close decision is in main process, independent of the renderer's persistence shape.

**Options considered.**
- (a) After empty-source, immediately spawn an empty page (mirror `checkEmptyPage` flow) before closing. Rejected — user dragged a tab OUT; they want fewer windows, not equivalent ones.
- **(b) — chosen.** Close source window as today.

### M8 — Pinned-tab interaction — **RESOLVED 2026-05-19**

**Problem.** Today pinned tabs can't be cross-window-dragged (`handleDragStart` skips the `application/persephone-tab` dataTransfer write; `handleDragEnd` early-returns on pinned). Same constraint stays useful — pinned tabs are users' "always available" anchors per window.

**Proposed:** No change. Document the rule. Pinned-ness is preserved across transfer (today's `desc.pinned` survives via `page.pinned = desc.pinned` in `restorePage`).

**Options considered.**
- (a) Allow cross-window drag of pinned tabs (unpin on the way). Rejected — surprises user.
- **(b) — chosen.** Pinned tabs stay non-droppable to other windows.

### M9 — Drag payload size budget — **RESOLVED 2026-05-19**

**Problem.** The IPC payload for `eMovePageOut`/`eMovePageIn` carries the `PageDescriptor`. After walkthrough 04, that's `editors[]` — every editor on the page, each with its `state` (editor-specific slice) and `host?.state` (host metadata). Sizes:
- Main editor's `state` (Monaco viewport, decorations IDs, etc.): kilobytes.
- Host metadata (filePath, language, modified, encoding, sourceLink): hundreds of bytes.
- Pipe descriptor: hundreds of bytes.
- Secondary-editor state (LinkEditorData, archive tree state): single-digit kilobytes.

Total for the most complex page (Archive with deep tree + bookmark expansions): ~50KB. Order of magnitude smaller than typical content blobs (Monaco buffer of a 1MB file).

**Proposed:** Accept the payload as-is. Electron IPC handles 50KB messages trivially (serialization budget for `webContents.send` is many MB). No streaming or chunking needed.

**Critical**: host content (the `content` string) MUST NOT be in `HostDescriptor.state`. It belongs in the per-editor cache file (`<editor.id>-host.txt`) so it doesn't ride the IPC. Walkthrough 04 / C7 + C9 establishes this convention; walkthrough 20 (Monaco / Text) implements it. Walkthrough 05 just inherits the rule.

**Options considered.**
- (a) Include `content` in the IPC payload (more self-contained, no cache-file dependency). Rejected — IPC bloat; defeats walkthrough 04 / C9 cache design.
- **(b) — chosen.** Payload is metadata-only; content lives in per-editor cache, accessed via `editor.restore()` on target.

### M10 — Active page focus after transfer — **RESOLVED 2026-05-19**

**Problem.** When target receives the moved page, does it auto-activate it?

**Implicit-focus mechanism (today, kept).** Both branches of `movePageIn` end with `s.ordered.push(page)`. `query.activePage` returns the last item of `ordered`, so the dropped page becomes the active page implicitly — no explicit `showPage` call needed. The user's drop gesture results in focus on the dropped tab without any extra focus-management code.

For a brand-new window (`createWindow` path): bootstrap-restore sees no openFiles state — the only page is the one we're moving in. Active by virtue of being the only entry in `ordered`.

For an existing-target window: the dropped page lands at the end of `ordered`, becoming active. This is what the user typically wants — they just dropped it; they expect to see it.

**Proposed:** No change. Today's implicit-via-ordered-push behavior is the desired outcome. If testing surfaces a case where it doesn't activate (e.g., a stale subscriber races the push, or a downstream consumer reads `ordered` before the splice completes), add an explicit `this.model.navigation.showPage(page.id)` after the splice — but don't pre-emptively add it now.

**Options considered.**
- (a) Add an explicit `showPage(page.id)` after splice (defensive). Rejected — `ordered.push` already makes the dropped page active; an explicit call is redundant noise until testing shows otherwise.
- **(b) — chosen.** Trust the implicit-via-ordered-push focus. Add `showPage` later only if testing surfaces a need.

---

## Proposed mockup adjustments

Pre-review. **None applied yet.**

### C1 — `editorRegistry.ts` mockup comment on `instanceId`

Resolves: M5.

Current `createEditor(id, instanceId?)` comment (added in walkthrough 04 / C2) mentions cache continuity for restore. Extend it to mention multi-window transfer as a second consumer:

```ts
/**
 * Instantiate an editor by registry key.
 *
 * @param id Registry key (e.g., "monaco", "grid-json", "pdf-view").
 * @param instanceId Optional instance UUID. When supplied, the new editor
 *   reuses this id instead of generating a fresh one. Used by:
 *   - Bootstrap restore (walkthrough 04 / P6 / C2) — per-editor cache files
 *     keyed on the prior id stay readable.
 *   - Multi-window transfer (walkthrough 05) — same id survives across
 *     `movePageOut` / `movePageIn`; cache files on disk are never re-keyed.
 *
 *   When omitted (new pages, view-switches), a fresh UUID is generated.
 */
async createEditor(id: string, instanceId?: string): Promise<EditorModel> { … }
```

### C2 — `PageModel.ts` mockup comment on `saveState()`

Resolves: M3.

Add a one-liner above the new `saveState()` method (added in walkthrough 04 / C7) noting the dual use:

```ts
/**
 * Flush all per-editor caches. Awaitable.
 *
 * Called by:
 *   - `RendererEventsService.handleBeforeQuit` — flush before quit (today).
 *   - `PagesLifecycleModel.movePageOut` — flush before detach so target's
 *     `editor.restore()` reads up-to-date content (walkthrough 05 / M3).
 *
 * Each editor's `saveState?()` MUST internally flush its own debounce.
 */
async saveState(): Promise<void> {
    await Promise.all(this.editors.map((e) => e.saveState?.()));
}
```

### C3 — `PagesPersistenceModel.restorePage` is the shared restore entry point

Resolves: M2.

The mockup for this method was sketched in walkthrough 04 / C5 as a private helper of `restoreState`. Promote to a public method on `PagesPersistenceModel`:

```ts
// walkthrough 04 / C5 — the helper, now public for IPC reuse
async restorePage(desc: PageDescriptor): Promise<PageModel | null> {
    // …same body as walkthrough 04 / C5 sketch…
}
```

Both call sites are real code, not mockup:
- `PagesPersistenceModel.restoreState` (bootstrap) — `Promise.all(data.pages.map(d => this.restorePage(d)))`.
- `PagesLifecycleModel.movePageIn` (IPC) — `await this.model.persistence.restorePage(data.page)`.

No mockup file change here — `PagesPersistenceModel.ts` isn't a foundation mockup. The decision is logged for implementation.

---

## Open questions for review

1. ~~**M1 — IPC payload shape.**~~ **Resolved 2026-05-19** — option (b): drop `schemaVersion` on the drag payload. Same-process same-version means the schema discriminator only needs to live at file boundaries (openFiles.txt), not in transient IPC messages. `PageDragData.page` picks up the new `PageDescriptor` shape at compile time from walkthrough 04 / C1.
2. ~~**M2 — unify restore paths.**~~ **Resolved 2026-05-19** — option (b): `PagesPersistenceModel.restorePage(desc)` is the shared entry point for bootstrap restore, IPC `movePageIn`, and `duplicatePage` (with fresh ids). `newEditorModelFromState` and `PAGE_TYPE_MIGRATIONS` in `PagesLifecycleModel` retire — `editorId`-keyed registry lookup in `restorePage` replaces them. One less hand-maintained restore path.
3. ~~**M3 — source flush order.**~~ **Resolved 2026-05-19** — option (b): `await page.saveState()` stays in `movePageOut`. The call is lighter than today (no sidebar cache file to write — only per-editor flushes via walkthrough 04 / C7). Establishes the invariant for editor walkthroughs 20–30: `EditorModel.saveState()` is an awaitable flush that drains the editor's own internal debounce, not a fire-and-forget save.
4. ~~**M4 — detach-without-dispose.**~~ **Resolved 2026-05-19** — option (b): comment-only. Today's `removePage` already does the right thing (splice without dispose); the dispose path lives on `page.onClose` which `detachPage` clears. Future readers get an explanatory comment so the "missing" `dispose()` call doesn't look like a bug.
5. ~~**M5 — editor-id continuity.**~~ **Resolved 2026-05-19** — option (b): no new mechanism. `editorRegistry.createEditor(id, instanceId)` (walkthrough 04 / C2) is the single route for cache-file id preservation; both bootstrap restore and IPC transfer pass `desc.id` as `instanceId`. One-liner update to `editorRegistry.ts` mockup comment to flag the dual use.
6. ~~**M6 — multi-editor transfer.**~~ **Resolved 2026-05-19** — option (b): per-editor salvage. Page-with-sidebar transfer is naturally atomic at the descriptor level (one `editors[]` array carries main + panel-contributors); restore parallelism + per-editor `console.warn + continue` from walkthrough 04 / P5 + P7 apply equally to IPC. No new logic.
7. ~~**M7 — empty-source window.**~~ **Resolved 2026-05-19** — option (b): close source on last-page-moved (unchanged from today). User dragged a tab OUT — they want fewer windows. Last-window-hides-instead-of-closes in main process (`open-windows.ts` `setCanQuit`) is unaffected.
8. ~~**M8 — pinned tabs.**~~ **Resolved 2026-05-19** — option (b): by design. Pinned tabs remain non-cross-window-draggable (today's behavior in `PageTab.handleDragStart` / `handleDragEnd`). Pinned-ness still rides the descriptor when a page IS transferred by other means (e.g., context-menu "Open in New Window") — `desc.pinned` survives via `restorePage`.
9. ~~**M9 — payload size.**~~ **Resolved 2026-05-19** — option (b): payload is metadata-only (~50KB worst case for archive-with-tree). Host content (`content` string) MUST stay in the per-editor cache file (`<editor.id>-host.txt`) and ride M5's cache-file continuity. Invariant logged for walkthrough 20 (Monaco / Text) when defining `HostDescriptor` `state` shape: no large blobs in the descriptor.
10. ~~**M10 — auto-focus on target.**~~ **Resolved 2026-05-19** — option (b): no explicit `showPage` call. The dropped page becomes active implicitly because `s.ordered.push(page)` appends to `ordered` and `query.activePage` returns its last item. Testing will confirm; if a race ever surfaces, add an explicit `showPage(page.id)` after the splice — but don't add it pre-emptively.

---

## Adjustments to current code (non-mockup)

Logged for the implementation phase:

- `src/shared/types.ts` — `PageDragData` already references `PageDescriptor`; gets the new shape via walkthrough 04 / C1. No additional change.
- `src/renderer/ui/tabs/PageTab.tsx` — `getDragData()` rewrite. Build the new `PageDescriptor` shape:
  ```ts
  page: {
      id: page.id,
      pinned: page.pinned,
      modified: page.modified,
      mainEditorId: page._mainEditorId,
      editors: page.editors.map(e => e.getRestoreData()),
      sidebar: page.pageNavigatorModel
          ? {
              open: page.pageNavigatorModel.state.get().open,
              width: page.pageNavigatorModel.state.get().width,
              activePanel: page.activePanel,
          }
          : undefined,
  },
  ```
- `src/renderer/api/pages/PagesLifecycleModel.ts`:
  - `movePageIn` rewrite per M2 — delegate to `restorePage(desc)`, keep target-index splice.
  - `movePageOut` rewrite per M3 — minimal cleanup; `await page.saveState()` stays.
  - Remove `newEditorModelFromState` (used only by today's `movePageIn` + `duplicatePage`; both rewrite to use `restorePage`).
  - Remove `PAGE_TYPE_MIGRATIONS` (driven by `state.type` which is gone in walkthrough 04 / P1 / S10).
  - `duplicatePage` rewrite — build a fresh-id descriptor, then call `restorePage`:
    ```ts
    duplicatePage = async (pageId: string) => {
        const page = this.model.query.findPage(pageId);
        if (!page) return;
        // Build descriptor from current page, then rewrite ids fresh.
        const desc: PageDescriptor = {
            id: crypto.randomUUID(),
            pinned: false,                                  // don't carry pin over
            modified: page.modified,
            mainEditorId: null,                              // re-pointed below
            editors: page.editors.map(e => {
                const d = e.getRestoreData();
                return { ...d, id: crypto.randomUUID() };  // fresh id → fresh cache files
            }),
            sidebar: undefined,                              // duplication doesn't carry sidebar
        };
        // Re-point mainEditorId to the new id at the same array index
        const oldMainIndex = page.editors.findIndex(e => e.id === page._mainEditorId);
        if (oldMainIndex >= 0) desc.mainEditorId = desc.editors[oldMainIndex].id;

        const newPage = await this.model.persistence.restorePage(desc);
        if (newPage) {
            this.model.attachPage(newPage);
            this.model.state.update(s => { s.pages.push(newPage); s.ordered.push(newPage); });
            this.model.layout.groupTabs(pageId, newPage.id, false);
        }
    };
    ```
- `src/renderer/api/pages/PagesPersistenceModel.ts` — promote `restorePage` from private to a method usable by `PagesLifecycleModel.movePageIn` (and `duplicatePage`).
- `src/renderer/api/pages/PagesModel.ts` — `removePage` gets the explanatory comment from M4. No code change.
- `src/main/open-windows.ts` — no change. The main process is shape-agnostic; it just relays `PageDragData` between renderers.
- `src/main/drag-model.ts` — no change. 100ms buffer logic survives.
- `src/ipc/api-types.ts` / `src/ipc/renderer/renderer-events.ts` — `eMovePageIn` / `eMovePageOut` event signatures inherit the new `PageDescriptor` shape from `src/shared/types.ts`. No new event endpoints needed.
- `src/renderer/api/internal/RendererEventsService.ts` — no change. `handleMovePageIn` / `handleMovePageOut` are pass-throughs to `pagesModel`.

---

## Files / concepts that are NOT changing

- `src/main/drag-model.ts` — buffering and consolidation logic unchanged.
- `src/main/open-windows.ts` — `movePageToWindow`, `createWindow`, `dropPosition` handling all unchanged. Main process stays renderer-version-agnostic.
- IPC event endpoints (`eMovePageOut`, `eMovePageIn`) — same names, same payload structure-by-shape; only the `PageDescriptor` type definition changes.
- `PageTab.handleDragStart` / `handleDragEnd` / `handleDrop` (other than `getDragData()`) — drag-event detection logic survives.
- `PageTab` pinned-tab gating — pinned tabs still can't cross-window-drag.
- `windowStates` / `openWindows.json` slot tracking in main process — unchanged.
- Cross-window editor-id collision risk — non-issue (UUIDs).
- Cross-window editor class registration — non-issue (both renderers register the same editorRegistry at boot).
- Cache directory layout (`<userData>/cache/<id>-*`) — unchanged. Per-editor cache files survive transfer via id-preservation (walkthrough 04 / C2).
- 100ms drag-event buffer — survives.

---

## Second-pass review (Tier 1 end — 2026-05-19)

Re-read against walkthroughs 06 and 07. M1–M10 all hold; the transfer flow is a thin wrapper over the walkthrough-04 persistence primitives.

### Downstream confirmations

- **From 06 / CK9**: Cross-window transfer of a compare pair is impossible by design (both pages of the pair can't be dragged simultaneously). This walkthrough already noted the constraint (M8 — pinned tabs aside, single-tab gesture only); 06 reinforces it from the compare-mode side. Both walkthroughs reach the same conclusion via different paths.
- **From 07 / GK5**: Multi-window transfer of a grouped page dissolves the group on the source — `fixGrouping` after `removePage` drops the dangling entry; target receives an ungrouped tab. The walkthrough-05 invariant "single-tab gesture by design" carries forward; 07 confirms no atomic pair transfer (would require `PageDragData` shape changes for no user benefit).

### Mockup snapshot vs. doc

`mockups/editorRegistry.ts` already has the C1 comment about dual-use `instanceId` (bootstrap restore + IPC transfer). `mockups/PageModel.ts` already has the C2 `saveState()` doc listing both callers. C3 (promote `restorePage` to public) is real-code only — `PagesPersistenceModel.ts` isn't a foundation mockup, so no file change.

### No new concerns

Multi-window transfer is the smallest Tier 1 walkthrough by net design change — once walkthrough 04 codified the new `PageDescriptor` shape and `createEditor(id, instanceId?)` route, transfer becomes a thin wrapper around the shared `restorePage(desc)` helper. M2's "unify with bootstrap restore" decision retires the most duplicated code path in the legacy `PagesLifecycleModel`. No surprises in the second pass.

The handoff to walkthrough 20 (Monaco) for the `HostDescriptor.state` no-large-blobs invariant (M9) stays valid; 20 will codify the exact field split.

---

## Status

- [x] Analysis written
- [x] Reviewed by user
- [x] Concerns resolved (decisions captured) — M1–M10 all resolved
- [x] Mockups updated per resolutions — `editorRegistry.ts` comment (C1), `PageModel.ts` comment (C2); C3 logged for real-code implementation
- [x] Logged in `concerns.md`
- [x] Marked `[x]` in `progress.md`
- [x] Second-pass review (2026-05-19) — confirmed against 06/07; no decision drift
