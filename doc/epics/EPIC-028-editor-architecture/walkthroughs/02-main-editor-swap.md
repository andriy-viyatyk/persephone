# 02 — Main editor swap walkthrough

Scope: the two distinct operations that change a page's main editor — **view-switch** (same content, different editor type) and **file-navigate** (different content, same page). Both pass through `PageModel.setMainEditor` today; under the new architecture they are clearly separate paths that share a single lifecycle primitive.

**Out of scope** (own walkthroughs): secondary editor panel lifecycle (`03`), persistence round-trip details (`04`), multi-window (`05`), compare mode (`06`), grouped pages (`07`), Notebook's per-note switch (`29`).

**Status:** Done (2026-05-19). All concerns S1–S10 resolved. Mockups updated — see B1, B2, B3, B4 below; new foundation primitive `ComponentQueue` (`mockups/ComponentQueue.ts`).

---

## What exists today

### Two distinct call sites, one shared primitive

Today every change of `page.mainEditor` goes through `PageModel.setMainEditor` (PageModel.ts:138-179), but there are two functionally different callers:

#### A. View-switch — `TextFileModel.changeEditor`

`TextEditorModel.ts:211-218`:
```ts
changeEditor = (editor: EditorView) => {
    const language = this.state.get().language ?? "";
    const validated = editorRegistry.validateForLanguage(editor, language);
    this.state.update((s) => { s.editor = validated; });
    this.detectContentEditor();
};
```

It is **not** an editor swap at all — it mutates `state.editor` on the same `TextFileModel`. The render layer (`RenderEditor.tsx`) reads `state.editor` to decide which view-model component to mount. `TextFileModel` is both the editor and the host, so "switching view" is a no-op on identity.

Call sites:
- `TextToolbar.tsx:194` — user clicks the SegmentedControl in the toolbar
- `NoteItemToolbar.tsx:157` — same widget inside a Notebook note (operates on `NoteItemEditModel`)
- `PageWrapper.ts:104` — `page.editor = "grid-json"` from scripts

Effects beyond the state mutation:
- Acquire/release of view-models happens at the React layer (`ContentViewModelHost.acquire/release`) via `useEffect` chains in the view code, not in the model.
- `detectContentEditor` re-runs because the active view may unlock or hide a "structured" content detection.
- Persistence trips because `state.editor` is in `getRestoreData()`.

#### B. File-navigate — `PagesLifecycleModel.navigatePageTo`

`PagesLifecycleModel.ts:447-548`: load a different file into an existing page (tab identity preserved). Used by all in-app link clicks (link editor, link-collection, search results, file-explorer double-click) via the open-handler pipeline (`open-handler.ts:35`).

Sequence:
1. Look up `page` by id; if no `page`, return.
2. `oldEditor.confirmRelease()` — prompt save dialog if modified. Bail if user cancels.
3. Build `newEditor`:
   - If the path doesn't exist on disk and isn't a virtual URL → `ui.notify("File not found...")` + create an empty `TextFileModel` with the basename as title.
   - Else `createEditorFromFile(filePath, pipe, target, title)` (newEditorModel + restore). On exception → `ui.notify("Failed to open …")` + empty `TextFileModel`.
4. Apply `sourceLink` / `title` overrides onto `newEditor.state` **before** `setMainEditor`, because `beforeNavigateAway` inspects `sourceLink`.
5. `page.setMainEditor(newEditor)` — the shared primitive (see C below).
6. `resubscribeEditor(page)` — rewire the persistence subscription to `newEditor.state`.
7. If new editor is a `TextFileModel` and there are `revealLine`/`highlightText` options → call those Monaco-specific methods. Else look up `getPreviewEditor(language, path)` and set `state.editor`.
8. `onShow.send(page)`, `onFocus.send(page)`, `persistence.saveState()`.

#### C. The shared primitive — `PageModel.setMainEditor`

`PageModel.ts:138-179`:
1. If both old and new exist and differ: `oldEditor.beforeNavigateAway(newEditor)`.
2. Check `survivesAsSecondary = secondaryEditors.includes(oldEditor)` — if true (e.g., archive editor demoted itself in `beforeNavigateAway`), skip dispose; else `oldEditor.setPage(null)` and queue for dispose.
3. Replace `_mainEditor`, call `newEditor.setPage(this)`.
4. `state.update(s => s.mainEditorId = newEditor?.id ?? null)` — UI re-render trigger.
5. `notifyMainEditorChanged()` — every secondary editor gets `onMainEditorChanged(newEditor)`. Some may clear their own `secondaryEditor` (opt out of survival) and are detached + disposed in the cleanup pass.
6. If `newEditor.state.secondaryEditor?.length` → `addSecondaryEditor(newEditor)` (registers it as a panel contributor too).
7. `setTimeout(() => oldEditor.dispose(), 0)` — defer disposal so React can unmount the Monaco view first (avoids the `Delayer "Canceled"` rejection).

### Why these two paths share `setMainEditor`

`setMainEditor` has been the chokepoint because the new editor must:
- Replace `_mainEditor` on the page
- Update `mainEditorId` reactive state (tabs read it for highlights, page-level toolbar reads it)
- Notify and re-evaluate secondary editor lifetime
- Hand off `page` reference and clean up the old one

The current code only fires `setMainEditor` from `navigatePageTo` and `promoteSecondaryToMain`. The view-switch path (A) doesn't call it — it just mutates `state.editor` on the same model.

### Implicit current behavior worth preserving

| Current behavior | Where |
|------------------|-------|
| Same tab id survives across file navigation (URL bookmarking, drag-to-window-id, etc.) | `setMainEditor` reuses `page.id` |
| Pending `revealLine` / `highlightText` carried across navigate when target is also `TextFileModel` | `navigatePageTo:512-528` — checks `type === "textFile"` |
| Auto-pick "preview" editor (Markdown preview, image, link-view) on file navigate based on extension | `navigatePageTo:528-541` — `getPreviewEditor` from registry |
| Save-prompt on navigate-away if old editor modified | `navigatePageTo:466-469` — `oldEditor.confirmRelease()` |
| `sourceLink` is set on new editor before `beforeNavigateAway` so Archive can keep itself as secondary | `navigatePageTo:497-503` (`setMainEditor` cleans up afterwards) |
| Same model can be in both `_mainEditor` and `secondaryEditors[]` (Pattern B) | Archive demote: `beforeNavigateAway` puts itself in `secondaryEditors` and `setMainEditor` does NOT dispose it |
| View-switch is reactive only — no dispose/recreate, undo history dies inside Monaco's own `ITextModel` | `TextEditorModel.changeEditor` — pure `state.update` |

---

## What the new architecture needs to support

Functional requirements (no regressions vs. today):

1. **Two distinct operations, ergonomically separate.** View-switch and file-navigate are now *different* in identity (view-switch replaces `EditorModel` instance) — the API should make that obvious.
2. **Same tab id across both operations.** Page identity is `PageModel.id`, never changes. Editor identity is `EditorModel.id` — view-switch transfers the id from old editor to new (so cache files survive — C9). File-navigate does **not** transfer id (old editor's id is fully released; new editor gets a fresh id).
3. **View-switch preserves content via host ownership transfer.** New editor adopts the old editor's `IContentHost` via `switchFrom`. The host is *one continuous object* across the swap.
4. **File-navigate creates a fresh editor + fresh host.** No host transfer. Old host is disposed (because its owning editor is disposed). New host is constructed inside the new editor's `restore()` from `applyRestoreData({filePath, pipe})`.
5. **Old editor confirmRelease before swap, regardless of path.** View-switch on a modified host: today this is a no-op since the host survives. New arch: same — the host still owns `modified`, content is preserved, so no prompt. File-navigate on a modified host: today prompts save. New arch: same — different file, content lost, prompt.
6. **Same secondary-editor reactions on either path.** Old main `beforeNavigateAway(newEditor)` → may flip itself to secondary or accept being detached. `notifyMainEditorChanged(newMain)` on remaining secondaries.
7. **Same shared primitive eventually.** Both paths converge on `PageModel.setMainEditor(newEditor)` (the unified-array shape from walkthrough 01). The work before that call differs; the page-level swap behavior is the same.
8. **Pending `revealLine`/`highlightText` carry on file-navigate** when target is text-bearing, no longer keyed by `type === "textFile"`.
9. **Auto-pick preview editor on file-navigate.** Today's `getPreviewEditor` logic survives, but via the new `editorRegistry.resolveForFile` + per-editor `accepts(...)` chain (foundation already in mockup).
10. **Script API** — `page.editor = "grid-json"` (PageWrapper) still works, with view-switch semantics (host preserved). Walkthrough 12 owns the facade rewrite; this walkthrough records the user-visible behavior.

---

## How the foundation mockups handle this

The mockups already give us most of the pieces:

- **View-switch** → `PageModel.switchMainEditor(newEditorId)` (PageModel.ts mockup lines 199-206):
  ```ts
  async switchMainEditor(newEditorId: string): Promise<void> {
      const oldEditor = this.mainEditor;
      if (!oldEditor) return;
      const newEditor = await editorRegistry.createEditor(newEditorId);
      newEditor.switchFrom(oldEditor);     // extracts host from old's trait
      await newEditor.restore();           // host already restored; only editor-state restored
      await this.setMainEditor(newEditor); // disposes old (host reference is null)
  }
  ```
  This is the three-phase lifecycle for the view-switch case: `createEditor → switchFrom → restore → setMainEditor`. C9 already says `switchFrom` copies `oldEditor.id` onto the new editor, so cache files (host content, script panel state, etc.) survive.

- **File-navigate** → still owned by `PagesLifecycleModel.navigatePageTo`, but rewritten to use the three-phase lifecycle:
  ```ts
  const editorId = options?.target ?? editorRegistry.resolveForFile(filePath);
  const newEditor = await editorRegistry.createEditor(editorId);
  newEditor.applyRestoreData({ filePath, pipe, sourceLink, title });
  await newEditor.restore();           // builds + restores fresh host
  await page.setMainEditor(newEditor); // disposes old editor + its host (no extraction)
  ```
  No host transfer. The old editor disposes its own host on `dispose()` because nothing extracted it.

- **The shared primitive** — `PageModel.setMainEditor` (PageModel.ts mockup lines 162-187) covers both paths. C9 cache-cleanup logic is already wired in: if `newEditor.id === oldEditor.id` (the view-switch case), skip the cache delete; otherwise (file-navigate), delete `<oldEditor.id>-*` after dispose.

- **`navigatePageTo`** stays the orchestrator for the file-navigate path. Its job is:
  1. `confirmRelease` on old editor
  2. Build new editor via three-phase lifecycle with `{filePath, pipe, sourceLink, title}`
  3. Error-path fallback to an empty editor (same as today)
  4. Apply navigation extras (revealLine, highlightText, preview-editor pick)
  5. `setMainEditor(newEditor)`
  6. `onShow` / `onFocus` / `persistence.saveState()`

  The `resubscribeEditor` call disappears — page-level persistence subscription is per-editor via `descriptorChanged` (A6), and `attach`/`detach` inside `setMainEditor` already maintains the subscription map (E4 from walkthrough 01).

### Mapping today → new

| Today | New |
|-------|-----|
| `TextFileModel.changeEditor(editor)` mutates `state.editor` | `PageModel.switchMainEditor(editorId)` — fresh `EditorModel` instance, host extracted from old editor via `switchFrom` |
| `PageWrapper.editor = X` (script API) calls `model.changeEditor(X)` | `PageWrapper.editor = X` calls `page.switchMainEditor(X)` (walkthrough 12 owns the facade) |
| `TextToolbar` SegmentedControl `onChange` calls `model.changeEditor` | The switch widget calls `page.switchMainEditor(newId)` (walkthrough 09 owns the widget) |
| `navigatePageTo` does `createEditorFromFile → setMainEditor → resubscribeEditor` | `navigatePageTo` does `createEditor → applyRestoreData → restore → setMainEditor` (resubscribe is implicit) |
| Pending `revealLine`/`highlightText` apply by `(newEditor as TextFileModel).revealLine(...)` | Pending applied via host setter on the *new* editor's host: `newEditor.contentHost?.revealLine?.(line)` — or via the editor's own API (walkthrough 20 defines the exact shape; this walkthrough commits to "carry across file-navigate" as a requirement) |
| `editorRegistry.getPreviewEditor(language, filePath)` chooses preview editor | `editorRegistry.resolveForFile(filePath, language)` (already in mockup) returns the same answer via the per-editor `accepts()` predicate; `navigatePageTo` uses it as the default `editorId` |

---

## Concerns surfaced (swap-specific)

### S1 — View-switch entry point: page method vs. editor method? — **RESOLVED 2026-05-19**

**Problem.** Today's `changeEditor` lives on `TextFileModel`. After refactor, `TextFileModel` is a host, not an editor. The view-switch must move somewhere. Two natural homes:

- (a) `PageModel.switchMainEditor(editorId)` — the page owns mainEditor identity, so it owns the swap.
- (b) `EditorModel.switchTo(editorId)` — the current editor knows about itself; calling `monaco.switchTo("grid-json")` reads naturally.

**Why it matters.** Whichever one is the "real" entry point shapes the switch widget, the script facade, and Notebook's per-note switching.

**Decision: option (a) — page-level.** Reasons:
1. Notebook's per-note switch is *not* a page swap — it operates on a transient `NoteItemEditModel`-bound editor inside a React list. That path has its own owner (walkthrough 29). Putting `switchTo` on `EditorModel` invites confusion: would the notebook note's embedded editor also expose `switchTo`? Yes — but it would NOT touch the page. Two semantics, same method name, is a footgun.
2. The page-level switch widget is rendered by page chrome (walkthrough 09). It already has the page in context. `page.switchMainEditor(id)` is one call.
3. `findCompatibleEditors()` is already on the editor — that's the only "the current editor introspects what it can become" responsibility. The actual swap is page-level.

**Options considered.**
- **(a) — chosen.** `PageModel.switchMainEditor(editorId)`.
- (b) `EditorModel.switchTo(editorId)` — rejected. Symmetry with `switchFrom` was the only argument for; `switchFrom` is an internal lifecycle hook (the page calls it inside `switchMainEditor`), not a user-facing entry point, so the symmetry isn't real cost.

### S2 — File-navigate target resolution: explicit `target` vs. `resolveForFile` — **RESOLVED 2026-05-19**

**Problem.** Today `navigatePageTo` accepts `options.target` (e.g., `"image-view"`, `"monaco"`) from the link pipeline. If absent, it calls `newEditorModel(filePath)` which internally uses `editorRegistry.resolve(filePath)`. After refactor, `editorRegistry.resolveForFile` is the single resolver — but how does it interact with an explicit `target`?

**Decision.** Priority order:
1. If `options.target` is set, use it directly (`editorRegistry.getById(options.target)` must exist; throw if not).
2. Else `editorRegistry.resolveForFile(filePath, language?)`.

Same semantics as today — the link pipeline's `target` override wins, the resolver is the fallback. No new abstraction.

### S3 — When does `applyRestoreData` get the `filePath` for the file-navigate case? — **RESOLVED 2026-05-19**

**Problem.** Three-phase lifecycle says: `createEditor → applyRestoreData → restore`. For file-navigate, the data we have is `{filePath, pipe, sourceLink, title}`. Today's `TextFileModel.applyRestoreData` accepts those fields — but it's also called from session-restore with the full persisted blob.

**Decision.** `applyRestoreData` is the single phase-2 entry. Its contract is "remember setup data; don't do I/O yet." Both call sites (open-file and session-restore) pass `Partial<T>` with whatever subset they have:
- Open-file: `{ filePath, pipe, sourceLink, title }`
- Session-restore: full persisted blob

`restore()` reads what's been remembered and does the rest (load file via pipe, decrypt, set content, etc.). No special-case wrapper. This matches A7 from walkthrough 01.

### S4 — Pending `revealLine` / `highlightText` carry semantics — **RESOLVED 2026-05-19**

**Problem.** Today's `navigatePageTo:512-528` checks `newEditor.state.get().type === "textFile"` and calls Monaco-specific `revealLine` / `setHighlightText` on the editor. After refactor, those methods live on the editor (Monaco-specific) or its host. The check `type === "textFile"` is gone. More broadly: this is one instance of a recurring Persephone pattern — model needs to tell its React view to do something, but the view may not be mounted yet.

**Decision.** Introduce a new foundation primitive `ComponentQueue` on `EditorModel` (mockup: `mockups/ComponentQueue.ts`). Mailbox semantics, FIFO, no coalescing (sender's responsibility). Single consumer at a time. Disposed on `EditorModel.dispose()`.

API surface (v1):
- `model.queue.send({type, ...payload})` — fire from model; runs handler if subscribed, else queues.
- `model.queue.use(handler)` — React hook; drains queue on mount, listens while mounted.
- `model.queue.subscribe(handler)` / `dispose()` — programmatic siblings.

Event types are per-editor TS unions. Editors that don't need imperative view commands ignore the queue. Monaco's union (v1): `{type: "revealLine", line} | {type: "highlightText", text} | {type: "focus"}`.

Flow for navigate-then-revealLine:
1. `navigatePageTo` passes `{filePath, pipe, sourceLink, title, revealLine?, highlightText?}` through `applyRestoreData` (no separate post-swap call).
2. Monaco's `applyRestoreData` sees the `revealLine` field and calls `this.queue.send({type: "revealLine", line})`.
3. When the Monaco view mounts (or if already mounted), `model.queue.use(...)` drains the event and the view applies it to the live `IStandaloneCodeEditor` instance.

Pushes Monaco-specific knowledge out of `navigatePageTo`. Replaces today's `_pendingRevealLine` / `_pendingHighlightText` fields on `TextFileModel` and the `acquireViewModel` pickup logic. Walkthrough 20 finalizes Monaco's full event union (may add scrollTo, setSelection, etc.).

**Future extension (NOT v1).** `register(name, value)` + `await execute(name, (ctx) => …, {timeout})` for view-context queries (script API `getSelection`, copy, etc.). Lands when a real use case drives it — likely walkthrough 12 (scripting facades) or walkthrough 20.

**Coalescing.** Considered but rejected — duplicate sends indicate a sender bug to fix at the source, not a queue concern.

### S5 — Auto-preview-editor pick on file-navigate: who decides? — **RESOLVED 2026-05-19**

**Problem.** Today's `navigatePageTo:528-541` does `getPreviewEditor(language, filePath)` after the swap and mutates `newEditor.state.editor`. After refactor, `state.editor` doesn't exist (view-switch creates a new editor instance, not a state field). So the "auto-pick preview editor" logic must happen *before* `createEditor`. And: the user wants the choice to be sensitive to a workflow mode — preview when reviewing, Monaco when editing.

**Decision.** Add a `mode: "edit" | "view"` field to `AcceptanceInput`. Each editor's `accepts()` returns -1 if it cannot handle the input (mode-independent); otherwise returns a priority in 0–100 that mode scales. `resolveForFile(fileName, language?, mode?)` picks the highest priority for the given mode. Default mode: `"edit"` (matches pre-epic behavior).

Per-editor priority shape:
- **MonacoEditor** — `mode === "edit"` → 100; `mode === "view"` → 30. Wins edit mode for any text; falls back in view mode.
- **MarkdownEditor / MermaidEditor / SvgEditor / HtmlEditor** — `mode === "view"` → 100 for matching extension; `mode === "edit"` → 20. Falls back to Monaco in edit mode.
- **NotebookEditor / LinkEditor / GridEditor** — content-typed; mode-agnostic. Always wins their dedicated file extension regardless of mode.
- **PdfEditor / ImageEditor / ArchiveEditor** — no edit alternative; mode-agnostic.

Two-rule contract for `accepts()`:
- **Returns -1**: truly incompatible. Mode-independent.
- **Returns 0–100**: valid candidate. Mode scales the priority. `findEditorsAccepting(host)` collects everything ≥ 0 and ignores priority for selection.

**Mode in the link pipeline.** Add `mode?: "edit" | "view"` to `ILinkData` (real-code change at `src/shared/link-data.ts` during implementation — not a mockup file). Entry points set mode where they care:
- **Explorer panel** — sets `mode: "view"` (preserves today's behavior).
- **Open file dialog / `openRawLink` without target / drag-drop** — omit mode → defaults to `"edit"` (preserves today's behavior).
- **Future Explorer toggle** — reads toggle state, sets mode accordingly. No other code path changes.

**Mode does NOT**:
- Persist on `IEditorState` (session-restore uses the persisted editor id directly).
- Gate `switchMainEditor` (the switch widget shows all valid editors regardless of mode).
- Apply when `options.target` is set (explicit target wins — S2 priority order).

**Replaces today's** `editorRegistry.getPreviewEditor(language, filePath)` and `editorRegistry.resolve(filePath)` — both collapse into the single `resolveForFile(fileName, language?, mode?)` call.

**Future Explorer toggle persistence** — scope of the toggle state (per-Explorer instance, per-window, or global app setting) is a UI design question deferred to the Explorer walkthrough (likely walkthrough 30 / no-host-group).

### S6 — Error-path fallback inside `navigatePageTo` — **RESOLVED 2026-05-19**

**Problem.** Today's `navigatePageTo` does two error-path fallbacks:
- `appFs.exists` returns false → ui.notify + create empty `TextFileModel`
- `createEditorFromFile` throws → ui.notify + create empty `TextFileModel`

After refactor, both should still happen but in the three-phase shape.

**Decision.** Each fallback creates a Monaco editor with no `filePath` and the basename as the title:
```ts
let newEditor: EditorModel;
try {
    newEditor = await editorRegistry.createEditor(resolvedId);
    newEditor.applyRestoreData({ filePath, pipe, sourceLink, title, revealLine, highlightText });
    await newEditor.restore();
} catch (err) {
    ui.notify(`Failed to open ${fpBasename(filePath)}: ${err.message}`, "error");
    newEditor = await editorRegistry.createEditor("monaco");
    newEditor.applyRestoreData({ title: title ?? fpBasename(filePath) });
    await newEditor.restore();
}
```
The pre-check `appFs.exists` collapses into the same try/catch — if the file isn't there, `restore()` throws and the catch path handles it uniformly. (Today's pre-check is just an optimization to skip the error throw; the catch path would handle it too.)

**Note.** This is the *navigate-page-to* error path. It is distinct from `restore()`'s *internal* error path (A7 from walkthrough 01), which falls back to an empty host inside the editor and notifies. The navigate-page-to error wrapper catches everything else (including `createEditor` itself failing).

### S7 — Where the script API `page.editor = X` lands — **RESOLVED 2026-05-19**

**Problem.** Today `PageWrapper.editor = X` calls `model.changeEditor(X)`. After refactor, `model.changeEditor` is gone. The script API needs a new wiring.

**Decision.** `page.editor = X` (script API) calls `page.switchMainEditor(X)`. Walkthrough 12 owns the facade rewrite; this walkthrough records the requirement.

**Throw policy on `PageModel.switchMainEditor(newEditorId)`** — throw on invalid input rather than silently failing:

| Condition | Behavior |
|-----------|----------|
| `newEditorId` not registered | **Throw** `Error("No editor registered for id: <X>")` |
| Current main editor has no `CONTENT_HOST_TRAIT` (no host to transfer) | **Throw** `Error("Current editor cannot give up its content; cannot switch")` |
| New editor does not accept the current host (`findEditorsAccepting(host)` doesn't include `newEditorId`) | **Throw** `Error("Editor <X> is not compatible with the current content")` |
| `newEditorId === oldEditor.editorId` | **No-op** (S10 short-circuit, no throw) |
| Page has no main editor | **No-op silent return** (matches today's `if (!oldEditor) return`) |

**Where throws are caught:**
- **Switch widget** (walkthrough 09) — built from `findCompatibleEditors()`, so it never offers an invalid choice. A throw here would indicate a bug; propagate naturally.
- **Script API PageWrapper.editor setter** — **catches and calls** `ui.notify(err.message, "error")`. Scripts can pass bad ids by mistake; the user sees a notification instead of a silent failure or unhandled rejection.
- **Direct internal callers** — propagate. If a test or programmatic caller misuses the API, the throw surfaces the bug.

Walkthrough 12 implements the PageWrapper try/catch wrapper; walkthrough 09 implements the widget; this walkthrough specifies the throw conditions on `switchMainEditor`.

### S8 — Pattern B (Archive demote on navigate) under the new arch — **RESOLVED 2026-05-19**

**Two distinct questions, separated for clarity:**

**(1) WHO decides the archive's fate?** ArchiveFileModel itself, via the `beforeNavigateAway(newModel)` override — unchanged from today. The archive examines `newModel.state.sourceLink?.sourceId` and either sets `this.secondaryEditor = ["archive-tree"]` (keep as sidebar panel) or `this.secondaryEditor = undefined` (drop).

**(2) HOW the page mechanically handles the result:**
- Today: archive's setter side-effect calls `page.addSecondaryEditor(this)`, putting the archive in BOTH `_mainEditor` AND `secondaryEditors[]` transiently. `setMainEditor` detects Pattern B and skips dispose. `promoteSecondaryToMain` has special bookkeeping.
- New: archive's setter is a pure state mutation (A8 from walkthrough 01 removed the side effect). Archive has exactly one membership in `editors[]`. `setMainEditor` reads `archive.contributesPanels()` (true after the setter), the visibility criterion keeps it. `_mainEditorId` flips to the new main; archive stays as a panel contributor.

**End result is identical.** The simplification is on the page-mechanics side, not on the archive's decision logic. The archive override survives unchanged from today (it's the canonical example of why `beforeNavigateAway` exists as a base-class hook).

**Test case for the eventual implementation:** open an archive → click a file inside → archive demotes to sidebar panel. Then click a file unrelated to the archive → archive's `secondaryEditor` clears and visibility criterion detaches+disposes it.

**Note on panel id:** today's archive secondary panel is `"archive-tree"` (not `"archive-view"` — that's the main view editor's id). Naming preserved.

### S9 — `confirmRelease` semantics on view-switch — **RESOLVED 2026-05-19**

**Problem.** Should `switchMainEditor` call `confirmRelease` on the old editor? Today: no — `changeEditor` (which it replaces) doesn't prompt. The host is preserved, so unsaved changes survive into the new view. Correct behavior.

**Decision.** `switchMainEditor` does **not** call `confirmRelease`. The old host transfers to the new editor unchanged (including its `modified` flag). User can still save from the new view. `navigatePageTo` keeps its `confirmRelease` call because the host is being replaced and unsaved changes would be lost.

**Invariant:** `confirmRelease` is only called when the host is about to die.

### S10 — Same-editor switch (no-op vs. refresh) — **RESOLVED 2026-05-19**

**Problem.** What if the user clicks the currently-selected editor in the switch widget (e.g., already in Grid, clicks Grid again)? And: how does the short-circuit identify "same editor" — by `type` field or a new `editorId` field?

**Decision (short-circuit):** No-op. `switchMainEditor(currentId)` returns silently when the new id equals the current editor's `editorId`. Captured in B2 mockup adjustment alongside the throw conditions from S7.

**Decision (identity field): remove `type`, add `editorId`.** Investigation found that today's `type: EditorType` field carries TWO concerns:
1. **Persistence key** — "which model class to instantiate on restore" (`editorDef.editorType === state.type`)
2. **Runtime classification** — "is this text-bearing / archive / browser / explorer?" (16+ string-equality checks scattered through the codebase)

In the new architecture both concerns have better-fitting answers:

| Today's `type` use | New replacement |
|--------------------|-----------------|
| `editorDef.editorType === state.type` (persistence lookup) | `editorDef.id === state.editorId` (B1) — `editorType` field on EditorDefinition collapses into `id` |
| `type === "textFile"` (is text-bearing?) — 5 call sites | `editor.traits.has(CONTENT_HOST_TRAIT)` (already in mockup, more precise) |
| `type === "fileExplorer"` / `"archiveFile"` / `"browserPage"` etc. (specific-class checks) | `editor instanceof ExplorerEditorModel` / `ArchiveEditorModel` / etc. — consistent with C1 resolution for host classes |
| `isTextFileModel(model)` type guard | `editor.contentHost instanceof TextFileModel` (or via trait) |
| `state.editor` (textFile view sub-discriminator) | Gone. Each view is its own EditorModel subclass with its own `editorId`. Grid modes' internal layout is walkthrough 21's call. |

**Why the broad-then-narrow split (`type=textFile`, `editor=monaco|grid|…`) is collapsed.** Today's "textFile" is a category (1-to-15 mapping in the registry). The new architecture makes every editor its own EditorModel subclass with its own registry id, so the category dissolves — the registry id IS the answer to "which class". The "is this text-bearing?" question, which was the main reason to keep the broad category, has a strictly better answer in trait queries.

**Migration scope.** Too broad for one walkthrough — each current `type` consumer migrates as its owning walkthrough lands:
- **Walkthrough 04 (persistence)** — registry-id-based restore (bumps major version per C2, no migration shim needed)
- **Walkthrough 12 (scripting facades)** — `PageWrapper.asBrowser/asMcpInspector` validations via `instanceof` or `editorId` equality
- **Walkthroughs 24 / 30** — archive/explorer specific-class checks
- **Walkthrough 09 (page toolbar)** — compare mode's `isTextFileModel` check
- **Walkthrough 20 (Monaco)** — text-bearing type-guard consumers

This walkthrough commits to:
- **`EditorModel.editorId: string`** (B1) — registry key, stable for the editor's lifetime.
- **`IEditorState.type` field**: marked for removal across the migration scope above.
- **`IEditorState.editor` field**: marked for removal (walkthrough 04 owns the persisted descriptor shape, which will reference `editorId` directly).
- **`EditorDefinition.editorType` field**: marked for removal (walkthrough 04 / persistence).

---

## Proposed mockup adjustments

Pre-review. **None applied yet.**

### B1 — Add `EditorModel.editorId`; remove `IEditorState.type` and `.editor`

Resolves: S10. Identity / persistence-key replacement across the codebase.

```ts
class EditorModel<...> {
    /** The registry key for this editor's class. Stable across the editor's lifetime.
     *  Replaces today's `IEditorState.type` + `IEditorState.editor` pair (both removed). */
    abstract readonly editorId: string;
}
```

Each subclass sets it to its registry id (`"monaco"`, `"grid-json"`, `"pdf-view"`, `"browser-view"`, …). Then `findCompatibleEditors`, `switchMainEditor` short-circuit, the switch widget's "current" highlight, persistence restore, and all `instanceof`-or-`editorId`-equality runtime checks use it.

Removed (across the migration scope listed in S10):
- `IEditorState.type: EditorType`
- `IEditorState.editor: EditorView`
- `EditorDefinition.editorType: EditorType` (walkthrough 04)
- `EditorType` and `EditorView` string-literal union types (no longer needed)
- `isTextFileModel(model)` type guard (replaced by `host instanceof TextFileModel` or `editor.contentHost instanceof TextFileModel`)
- `PAGE_TYPE_MIGRATIONS` table (C2 — bumping major version means no old-format migration)

### B2 — `PageModel.switchMainEditor` validates + short-circuits

Resolves: S7, S10.

```ts
async switchMainEditor(newEditorId: string): Promise<void> {
    const oldEditor = this.mainEditor;
    if (!oldEditor) return;                                  // S7 — silent no-op
    if (oldEditor.editorId === newEditorId) return;          // S10 — silent no-op

    // S7 — validate before we do any work
    if (!editorRegistry.getById(newEditorId)) {
        throw new Error(`No editor registered for id: ${newEditorId}`);
    }
    const trait = oldEditor.traits.get(CONTENT_HOST_TRAIT);
    if (!trait) {
        throw new Error("Current editor cannot give up its content; cannot switch");
    }
    const host = (oldEditor as any)._host;                   // editor-private; or via getter
    if (!editorRegistry.findEditorsAccepting(host).includes(newEditorId)) {
        throw new Error(`Editor ${newEditorId} is not compatible with the current content`);
    }

    // Three-phase lifecycle (already in mockup PageModel.ts)
    const newEditor = await editorRegistry.createEditor(newEditorId);
    newEditor.switchFrom(oldEditor);
    await newEditor.restore();
    await this.setMainEditor(newEditor);
}
```

Open detail: how the validator reads the host. Two choices — (a) editor exposes `getContentHost()` as a private-by-convention getter, or (b) the validation moves into `findEditorsAccepting` to accept either a host OR an editor (`findEditorsAccepting(editor)` looks up its own host via the trait). Walkthrough 09 (switch widget) will already need a similar lookup; preferred answer lives there. For now the mockup uses `(oldEditor as any)._host` as a placeholder.

### B3 — `PagesLifecycleModel.navigatePageTo` rewrite shape

Resolves: S2, S3, S4, S5, S6.

Pseudo-code (not a mockup file; lives as a sketch here):
```ts
navigatePageTo = async (
    pageId: string,
    newFilePath: string,
    options?: {
        revealLine?: number;
        highlightText?: string;
        sourceLink?: ILinkData;
        pipe?: IContentPipe;
        target?: string;
        title?: string;
    }
): Promise<boolean> => {
    const page = this.model.query.findPage(pageId);
    if (!page) return false;

    const oldEditor = page.mainEditor;
    if (oldEditor) {
        const released = await oldEditor.confirmRelease();
        if (!released) return false;
    }

    // Phase 1 — resolve editor id
    const editorId = options?.target
        ? options.target
        : editorRegistry.resolveForFile(
              newFilePath,
              /* language? */ undefined,
              options?.sourceLink?.mode ?? "edit",     // S5 — mode from link, default "edit"
          );

    // Phases 2 + 3 — build + restore the new editor, with error wrap
    let newEditor: EditorModel;
    try {
        newEditor = await editorRegistry.createEditor(editorId);
        newEditor.applyRestoreData({
            filePath: newFilePath,
            pipe: options?.pipe,
            sourceLink: options?.sourceLink,
            title: options?.title,
            revealLine: options?.revealLine,        // S4 — into the editor's pending state
            highlightText: options?.highlightText,
        });
        await newEditor.restore();
    } catch (err) {
        ui.notify(`Failed to open ${fpBasename(newFilePath)}: ${(err as Error).message}`, "error");
        newEditor = await editorRegistry.createEditor("monaco");
        newEditor.applyRestoreData({ title: options?.title ?? fpBasename(newFilePath) });
        await newEditor.restore();
    }

    // Page-level swap (handles beforeNavigateAway, dispose, notify, visibility)
    await page.setMainEditor(newEditor);

    this.model.onShow.send(page);
    this.model.onFocus.send(page);
    this.model.persistence.saveState();
    return true;
};
```

Notes:
- No `resubscribeEditor` — `PageModel.setMainEditor` already does attach/detach which the persistence subscription map watches via E4 (walkthrough 01).
- `revealLine`/`highlightText` are forwarded through `applyRestoreData`; the editor decides what to do with them (Monaco stores into pending fields). Walkthrough 20 confirms the field names.
- Auto-preview-editor pick happens inside `resolveForFile` via the per-editor `accepts()` predicate — walkthrough 04 / 22 confirm.

### B4 — `ComponentQueue` foundation primitive — **NEW**

Resolves: S4.

New mockup file `mockups/ComponentQueue.ts`. Adds a typed mailbox primitive for model → view imperative commands. EditorModel base class gains a `queue: ComponentQueue<E>` field with a generic event type parameter (third generic `E extends ComponentQueueEvent`).

`EditorModel.dispose()` becomes non-empty (calls `this.queue.dispose()`). Subclass overrides must call `super.dispose()`.

`IEditorState` does NOT gain `revealLine` / `highlightText` fields — they pass through `applyRestoreData`'s argument as an extension of the base partial type. Monaco's `applyRestoreData` accepts `Partial<MonacoEditorState> & { revealLine?: number; highlightText?: string }`, extracts those into queue events, ignores them otherwise. Walkthrough 20 finalizes the exact MonacoQueueEvent union.

This also opens the door for downstream cleanups (not in scope here, but listed for tracking):
- `TextFileModel._pendingRevealLine` / `_pendingHighlightText` — delete during walkthrough 20.
- `PageModel._pendingActivePanel` — could move to a PageModel-side queue (different primitive instance, same class) during walkthrough 04.
- `ContentViewModelHost.acquire/release` ref-counting — entire system dies in this epic; queue covers its "wait for view" half.

---

## Open questions for review

1. ~~**S1 — view-switch entry point.**~~ **Resolved 2026-05-19** — `PageModel.switchMainEditor(editorId)`.
2. ~~**S5 — preview-vs-edit.**~~ **Resolved 2026-05-19** — `mode: "edit" | "view"` field on `AcceptanceInput` + `ILinkData`. Explorer toggle UI persistence deferred to walkthrough 30.
3. **S7 — script API on no-host editor.** If `page.editor = "grid-json"` runs on a PDF page (no CONTENT_HOST_TRAIT), throw or no-op? Walkthrough 12 will decide; recording the question here for context.
4. **S10/B1 — `editorId` field on `EditorModel`.** Confirming the field exists. If yes, does `state.editor` go away entirely now (under walkthrough 04) or stay as a compatibility hint for one cycle?
5. **B4 — `revealLine`/`highlightText` typing.** ComponentQueue replaces the pending-fields approach (S4). Final Monaco event union owned by walkthrough 20.

---

## Adjustments to current code (non-mockup)

Logged for the implementation phase:

- `TextFileModel.changeEditor` — **delete**. View-switch lives at the page level.
- `TextFileModel.detectContentEditor`, `scheduleDetection`, `cancelDetection`, `_detectTimer`, `detectedContentEditor` field — **delete**. Replaced by on-demand `editorRegistry.findEditorsAccepting(host)` from the switch widget (C7 resolution).
- `PageWrapper.editor` setter — **rewire** to call `page.switchMainEditor(value)`. Walkthrough 12 owns.
- `TextToolbar` SegmentedControl `onChange` — **rewire** to call `page.switchMainEditor(newId)`. Walkthrough 09 owns the widget; the call shape comes from here.
- `NoteItemToolbar` SegmentedControl `onChange` — **rewire** to per-note switch (walkthrough 29 owns).
- `PagesLifecycleModel.navigatePageTo` — **rewrite** per B3 sketch.
- `PagesModel.resubscribeEditor` — **delete** (E4 from walkthrough 01 covers it via attach/detach).
- `PageModel.setMainEditor` — already updated in walkthrough 01 mockup; no further change here.
- `EditorModel.editorId: string` field — **add** (B1). Each subclass sets to its registry id.
- `EditorRegistry.getPreviewEditor` — **delete**. The same logic is the per-editor `accepts()` predicate (already in mockup, S5).
- `EditorRegistry.resolve` (no-arg base form) — **delete**. Collapses into `resolveForFile(fileName, language?, mode?)`.
- `IEditorState.editor` field — **delete** (under walkthrough 04's persisted descriptor shape).
- `ILinkData` (`src/shared/link-data.ts`) — **add** optional `mode?: "edit" | "view"` field. Producers (Explorer panel sets `"view"`; everything else omits) (S5).

---

## Files to read for context (no changes needed)

- `src/renderer/editors/text/TextEditorModel.ts:211-218` — current `changeEditor` body
- `src/renderer/api/pages/PageModel.ts:138-179` — current `setMainEditor`
- `src/renderer/api/pages/PagesLifecycleModel.ts:447-548` — current `navigatePageTo`
- `src/renderer/api/pages/PagesModel.ts:63-98` — current attach + resubscribe
- `src/renderer/editors/base/EditorModel.ts:102-104` — current `beforeNavigateAway` base
- `src/renderer/content/open-handler.ts:27-43` — where `navigatePageTo` is invoked from the link pipeline
- `src/renderer/scripting/api-wrapper/PageWrapper.ts:102-106` — script API setter

---

## Second-pass review (Tier 1 end — 2026-05-19)

Re-read against walkthroughs 03–07 and the final mockup shape. The swap design holds — S1 (page-level entry), S4 (ComponentQueue), S5 (mode field), S7 (throw policy), S8 (Pattern B dissolves), S9 (confirmRelease invariant), S10 (editorId field) all survive intact. Two sketches inside this doc accreted refinements from later walkthroughs that should be read as updates:

### Refinements from later walkthroughs

- **From 04 / C2 / P6**: `editorRegistry.createEditor(id, instanceId?)` now accepts an optional id. **B2's sketch** (`switchMainEditor` validates + short-circuits) currently calls `createEditor(newEditorId)` without `instanceId`. C9 (cache continuity across switch) is delivered NOT by passing `instanceId` to `createEditor`, but by `switchFrom(oldEditor)` copying `oldEditor.id` onto the new editor inside the editor's own `switchFrom` implementation — that's why `EditorModel.ts` mockup's `switchFrom` doc says "(1) copy `oldEditor.id` into this editor's `state.id`." So B2's sketch is correct as written; the `instanceId` route is for restore-from-disk paths only.
- **From 04 / P1 / C3**: `applyRestoreData` now takes `RestoreData<S>` (per-subclass `Partial<S>` + optional `host?: HostDescriptor` + optional `revealLine` / `highlightText`). **B3's `navigatePageTo` sketch** passes `{filePath, pipe, sourceLink, title, revealLine, highlightText}` — read these as Monaco-side fields on the host descriptor (`filePath`, `pipe`, `sourceLink`) versus passthroughs (`revealLine`, `highlightText`) that Monaco translates to `this.queue.send({...})`. The sketch is conceptually correct; walkthrough 20 codifies the exact split between `host` block and bare passthroughs.
- **From 04 / S10 migration**: `IEditorState` itself is retired (not just `.type` / `.editor`). The B3 sketch shows `options?.sourceLink?.mode` — confirmed correct; `ILinkData.mode` is the new optional field per S5.
- **From 06 / CK7**: `PageModel.setMainEditor` gains a cleanup hook for compare mode when the new main's host isn't `TextFileModel`. This is real-code-only; doesn't appear in `PageModel.ts` mockup because `compareGroups` lives on `PagesModel.state`. The `switchMainEditor → setMainEditor` flow needs to trigger this hook indirectly. Worth noting in the implementation phase but no walkthrough-02 decision needs updating.
- **From 07 / GK2** *(signature refined 2026-05-20 by walkthrough 08 / T2)*: `pagesModel.query.getTextFileHost(pageId): TextFileModel | null` is the centralized "is this page text-bearing" helper. Replaces today's `type === "textFile"` scatter at the call-site level — extends S10's migration scope to one more call site (`requireGroupedText`) plus the 14 PageTab callsites. Returns the typed host so callers can also reuse it for method calls; truthy check works as predicate. Doesn't change any decision here.

### Stability check

The "Migration scope handed off" list at the top of the doc (persistence registry-id, PageWrapper validations, Compare's `isTextFileModel`, text-bearing type-guards, archive/explorer instance-checks) all landed correctly in their target walkthroughs (04, 12, 09, 20, 24/30). No drift; S10 stays the unified discriminator-collapse story.

### No new concerns

The `mode: "edit" | "view"` field is consumed only by the Explorer entry point so far (sets `"view"`); other paths default to `"edit"`. Walkthrough 30 (Explorer) and any future "open as preview" UX will exercise this further but don't reshape the contract.

`ComponentQueue` (S4 / B4) lands cleanly as the foundation primitive. Walkthrough 20 (Monaco) will define the event union; walkthrough 12 may extend with `register`/`execute` for view-context queries. No reshape needed here.

---

## Status

- [x] Analysis written
- [x] Reviewed by user
- [x] Concerns resolved (decisions captured) — S1–S10 all resolved
- [x] Mockups updated per resolutions — ComponentQueue (new), EditorModel.ts (`queue` field + 3rd generic + `dispose` clears queue), editorRegistry.ts (`mode` field on AcceptanceInput + `resolveForFile` param + `findEditorsAccepting` mode-agnostic doc)
- [x] Logged in `concerns.md`
- [x] Marked `[x]` in `progress.md`
- [x] Second-pass review (2026-05-19) — sketches confirmed consistent with later mockup changes; no decision drift
