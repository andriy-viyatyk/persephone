# Monaco / Text editor walkthrough

> **Status:** Done 2026-05-20. Tier 5 opener — sets the template for every text-bearing editor (21–29). All ten concerns (MO1–MO10) RESOLVED. One tiny mockup edit landed (MO7: `focus(): void { /* override */ }` no-op on `mockups/EditorModel.ts`).

Walkthrough 20 finalizes the new `MonacoEditor` subclass: the EditorModel that wraps a `TextFileModel` content host and renders the Monaco code editor. Tier 1–4 already pinned the cross-cutting shape (host split, lifecycle, registry, persistence, chrome, scripting, MCP); this walkthrough is the first one that does the *editor-side* assembly end-to-end. Once Monaco lands, the remaining text-bearing editors (Grid, Markdown, Mermaid, SVG, HTML, Link, Todo, Log, RestClient, Graph, Draw, Notebook) follow this template with their own state slices and queue events.

---

## State today

`src/renderer/editors/text/` houses **eight** files that collectively implement "the text editor" today:

| File | Role |
|------|------|
| `TextEditorModel.ts` | `TextFileModel extends EditorModel<TextFileEditorModelState, void>` — the EditorModel that lives on the page tab. Also implements `IContentHost`. Owns submodels + portal refs + ContentViewModelHost. **The conflated class this epic dissolves.** |
| `TextEditor.tsx` | `TextViewModel extends ContentViewModel<TextEditorState>` — wraps Monaco's `IStandaloneCodeEditor` instance, exposes `revealLine` / `setHighlightText` / `getSelectedText` / `getCursorPosition` / `insertText` / `replaceSelection` / `focusEditor`. View component `TextEditor` reads `useContentViewModel<TextViewModel>(model, "monaco")`. |
| `TextEditorView.tsx` | Wrapper that hosts the toolbar / footer / script panel / overlay frame + `<ActiveEditor>` body. Subscribes to `pagesModel.onFocus`; binds root `onKeyDown` to `model.handleKeyDown`. **Dissolves entirely under walkthrough 10 / TC3.** |
| `ActiveEditor.tsx` | Dispatcher that reads `state.editor` and renders either `<TextEditor>` (Monaco) or `<AsyncEditor>` (Grid/Markdown/…). Always falls back to `<TextEditor>` when `encrypted === true` (the per-editor encryption guard). **Retires under TC11 / S10.** |
| `TextToolbar.tsx` | NavPanel + Compare + Run + Run-all + Show-resources buttons; portal `<div ref={setEditorToolbarRefFirst} />` + `<div ref={setEditorToolbarRefLast} />` markers; switch-widget `<SegmentedControl>`. **Dissolves into `<PageToolbar>` (walkthrough 09) + `<TextChrome>` (walkthrough 10).** |
| `TextFooter.tsx` | script-toggle button + per-editor portal `<div ref={setFooterRefLast} />` + encoding label. **Dissolves into `<TextChrome>` footer row.** |
| `ScriptPanel.tsx` | `ScriptPanelModel extends TModel<ScriptPanelState>` — script-library-aware Monaco mini-editor in a collapsible panel. Owned by `TextFileModel.script`. Stays host-owned per TC6 (no relocation). |
| `TextFileIOModel.ts` / `TextFileEncryptionModel.ts` / `TextFileActionsModel.ts` | Three submodels owned by `TextFileModel`. Today they reference `this.model` as the dual editor-and-host. Under EPIC-028 they become host-only submodels; references to `page`/`secondaryEditor`/`handleKeyDown` stay because **the host now owns those concerns at the host level** — the host's `handleKeyDown` is invoked by `<TextChrome>` per TC9. |
| `paste-rich-text.ts` | Pure helper: `convertHtmlToMarkdown`, `readClipboardHtml`. View-only. Unchanged. |

### Today's state shape (`TextFileEditorModelState extends IEditorState`)

Flat record mixing editor identity, host content, and view-deferred state:

```typescript
interface TextFileEditorModelState extends IEditorState {
    // Editor identity (S10 retires both):
    type: "textFile";              // class discriminator — gone
    editor?: EditorView;           // which view to render — gone

    // Editor metadata (walkthrough 20 keeps under refactor):
    title: string;
    modified: boolean;
    secondaryEditor?: EditorView[];

    // Host content + file metadata (migrates to TextFileHostState):
    content: string;
    language?: string;
    filePath?: string;
    encoding?: string;
    password?: string;
    encrypted?: boolean;
    temp: boolean;
    restored: boolean;
    deleted: boolean;
    pipe?: PipeDescriptor;

    // Cross-cutting that goes elsewhere:
    compareMode: boolean;          // → PagesModel.state.compareGroups (CK1)
    detectedContentEditor?: EditorView; // → editorRegistry.findEditorsAccepting on demand (mockup TextFileModel notes)
}
```

### Today's per-editor surface

- **Portal refs** (`editorToolbarRefFirst/Last`, `editorFooterRefLast`, `editorOverlayRef`) — relocated to React composition per C8 / walkthrough 10.
- **Pending view operations** (`_pendingRevealLine`, `_pendingHighlightText`) — Monaco-specific, today on TextFileModel; relocated under S4 → `ComponentQueue` (walkthrough 02 / B1).
- **Synchronous Monaco access via ContentViewModelHost** (`acquireViewModelSync("monaco")`) — pull-from-view pattern; retired under SF2 + SF6 (script API moves to `queue.execute(...)` per walkthrough 12 / B1).
- **Background content-based editor detection** (`_detectTimer` + `scheduleDetection` + `cancelDetection` + `detectContentEditor` + `detectedContentEditor` state) — the timer-driven autodetect retires per the mockup `TextFileModel` notes; switch widget calls `editorRegistry.findEditorsAccepting(host)` on demand (which can peek at content per the registry's `accepts()` contract — `mockups/editorRegistry.ts:62-80`).
- **`changeEditor(editor)`** — TextFileModel imperative method that writes `state.editor`. Retired under S1 + S10: callers move to `page.switchMainEditor(editorId)`; the host has no notion of "active editor" anymore.

---

## State after refactor

Two new classes replace `TextFileModel extends EditorModel<TextFileEditorModelState, void>`:

### `TextFileModel` (host) — already mocked at [`mockups/TextFileModel.ts`](../mockups/TextFileModel.ts)

Pure `IContentHost`. Owns: `content`, `language`, `id`, `filePath`, `modified`, `encoding`, `encrypted`, `password`, `temp`, `restored`, `pipe`. Submodels (`io`, `encryption`, `script`, `actions`) move under the host unchanged in shape. Host-level `handleKeyDown` delegates to `TextFileActionsModel.handleKeyDown` (Ctrl+S / Shift+Ctrl+S / F5 / Ctrl+Shift+F → search-in-NavPanel / F2 → rename). Already covered by Tier 1–4 walkthroughs; this walkthrough does not re-design the host shape.

### `MonacoEditor` (editor) — **new class introduced by this walkthrough**

```typescript
class MonacoEditor extends EditorModel<MonacoEditorState, void, MonacoQueueEvent, MonacoQueueRequest> {
    readonly editorId = "monaco";

    private _host: TextFileModel | null = null;
    private _hostStateUnsub: (() => void) | null = null;  // host → editor descriptorChanged forwarder

    // ── Required base overrides ─────────────────────────────────────────

    get contentHost(): IContentHost | null { return this._host; }

    findCompatibleEditors(): string[] {
        return this._host ? editorRegistry.findEditorsAccepting(this._host) : [];
    }

    isFreshEmpty(): boolean {
        // EW10 — Monaco-only override.
        const h = this._host;
        if (!h) return false;
        const hs = h.state.get();
        return hs.content === "" && hs.filePath === undefined && !hs.modified
            && this.state.get().title === "";
    }

    getNavigatorTarget(): { pipe?: IContentPipe | null; filePath?: string | null } | null {
        // PT5 / B3 — page-level NavPanel button discoverability.
        if (!this._host) return null;
        const { filePath } = this._host.state.get();
        if (!this.page?.canOpenNavigator(this._host.pipe, filePath) && !filePath) return null;
        return { pipe: this._host.pipe, filePath };
    }

    hasTextSelection(): boolean {
        // PT7 — Run-all-script visibility gate.
        return this.state.get().hasSelection;
    }

    // ── Persistence (P6 / C3) ───────────────────────────────────────────

    getRestoreData(): EditorDescriptor {
        return {
            ...super.getRestoreData(),
            host: this._host?.getDescriptor(),
        };
    }

    applyRestoreData(data: RestoreData<MonacoEditorState>): void {
        const s = this.state;
        s.update((cur) => {
            if (data.title !== undefined) cur.title = data.title;
            if (data.modified !== undefined) cur.modified = data.modified;
            if (data.secondaryEditor !== undefined) cur.secondaryEditor = data.secondaryEditor;
        });
        if (data.host) {
            this._pendingHost = data.host;
        }
        if (data.revealLine !== undefined) {
            this.queue.send({ type: "revealLine", line: data.revealLine });
        }
        if (data.highlightText !== undefined) {
            this.queue.send({ type: "highlightText", text: data.highlightText });
        }
    }

    // ── Three-phase lifecycle ───────────────────────────────────────────

    switchFrom(oldEditor: EditorModel): void {
        const trait = oldEditor.traits.get(CONTENT_HOST_TRAIT);
        if (!trait) throw new Error(`Cannot switchFrom ${oldEditor.editorId}: no CONTENT_HOST_TRAIT`);
        const host = trait.extractContentHost();
        if (!(host instanceof TextFileModel)) {
            throw new Error(`Cannot switchFrom: host is not a TextFileModel`);
        }
        // C9 — copy old editor id so cache files survive the swap.
        this.state.update((s) => { s.id = oldEditor.id; });
        host.setStorage(this.stateStorage);
        this.adoptHost(host);
    }

    async restore(): Promise<void> {
        try {
            if (!this._host) {
                this._host = this._pendingHost
                    ? await TextFileModel.fromDescriptor(this._pendingHost)
                    : new TextFileModel();
                this._host.setStorage(this.stateStorage);
            }
            if (!this._host.state.get().restored) {
                await this._host.restore();
            }
            this.adoptHost(this._host);
        } catch (err) {
            ui.notify((err as Error).message || "Failed to restore Monaco editor.", "error");
            this._host = new TextFileModel();
            this._host.setStorage(this.stateStorage);
            this.adoptHost(this._host);
        }
    }

    // ── Host adoption (shared between switchFrom + restore) ─────────────

    private adoptHost(host: TextFileModel): void {
        this._host = host;
        // A6 — forward host state mutations onto our descriptorChanged signal
        // so PagesModel's persistence-debounce subscription catches content edits.
        this._hostStateUnsub?.();
        this._hostStateUnsub = host.state.subscribe(() => this.descriptorChanged.send());
        // Carry forward host-derived editor title for tab strip + isFreshEmpty.
        const { filePath, title } = host.state.get() as any;
        if (title || filePath) {
            this.state.update((s) => {
                s.title = title ?? (filePath ? fpBasename(filePath) : "");
            });
        }
    }

    // ── CONTENT_HOST_TRAIT — give up host on switchFrom of NEXT editor ─

    constructor(state: TComponentState<MonacoEditorState>) {
        super(state);
        this.traits.set(CONTENT_HOST_TRAIT, {
            extractContentHost: (): IContentHost => {
                const host = this._host;
                if (!host) throw new Error("Host already extracted from MonacoEditor");
                this._hostStateUnsub?.();
                this._hostStateUnsub = null;
                this._host = null;
                return host;
            },
        });
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    async saveState(): Promise<void> {
        await this._host?.io.saveState();
        // Monaco view-state (folded regions, viewport scroll) — see MO11 if
        // we decide to persist it; today we don't.
    }

    async dispose(): Promise<void> {
        this._hostStateUnsub?.();
        this._hostStateUnsub = null;
        // Only dispose host if we still own it (not extracted by switchFrom).
        if (this._host) {
            await this._host.dispose();
            this._host = null;
        }
        await super.dispose();  // drains queue (rejects pending requests with disposal error)
    }
}
```

### `MonacoEditorState`

```typescript
interface MonacoEditorState extends EditorStateBase {
    /** Whether the Monaco instance currently has a non-empty selection.
     *  Written by the view's selection listener; read by chrome's Run-all
     *  visibility gate (PT7) and by isFreshEmpty's title check. */
    hasSelection: boolean;
}

const defaultMonacoEditorState: MonacoEditorState = {
    id: "",                  // assigned by editorRegistry.createEditor
    title: "",
    modified: false,
    secondaryEditor: undefined,
    hasSelection: false,
};
```

What lives **on the editor**:
- Identity (`id`, `title`, `modified`, `secondaryEditor`).
- Selection presence (`hasSelection`) — written by the view's Monaco selection listener; read by `<TextChrome>`'s Run-all visibility gate.
- Pending revealLine / highlightText events — via the queue, not on state.
- `_pendingHost: HostDescriptor | undefined` — staged by `applyRestoreData`, consumed by `restore()`.

What lives **on the host (`TextFileModel`)**:
- All content + file metadata.
- All file I/O, encryption, script panel, actions submodels.
- Pipe lifecycle.
- `handleKeyDown` (delegated to `actions.handleKeyDown`).

### Queue event + request unions

```typescript
// Fire-and-forget (S4 — model → view commands).
type MonacoQueueEvent =
    | { type: "revealLine";    line: number }
    | { type: "highlightText"; text: string | undefined }
    | { type: "focus" };

// Request/reply (SF6 — view-context queries).
type MonacoQueueRequest =
    | { type: "getSelectedText" }
    | { type: "getCursorPosition" }
    | { type: "insertText";       text: string }
    | { type: "replaceSelection"; text: string };
```

`MonacoEditor` exposes typed wrappers around `queue.send` / `queue.execute`:

```typescript
revealLine(line: number): void { this.queue.send({ type: "revealLine", line }); }
setHighlightText(text: string | undefined): void { this.queue.send({ type: "highlightText", text }); }
focusEditor(): void { this.queue.send({ type: "focus" }); }
async getSelectedText(): Promise<string> {
    return this.queue.execute({ type: "getSelectedText" }) as Promise<string>;
}
async getCursorPosition(): Promise<{ lineNumber: number; column: number }> {
    return this.queue.execute({ type: "getCursorPosition" }) as Promise<{ lineNumber: number; column: number }>;
}
async insertText(text: string): Promise<void> {
    await this.queue.execute({ type: "insertText", text });
}
async replaceSelection(text: string): Promise<void> {
    await this.queue.execute({ type: "replaceSelection", text });
}
```

---

## UI shape

```
<TextChrome model={monacoEditor}>            ← walkthrough 10 / TC3, hosts page-level toolbar + footer + script panel
    <MonacoBody model={monacoEditor} />      ← THIS walkthrough — the bare Monaco editor
</TextChrome>
```

### `MonacoBody` view (replaces today's `TextEditor.tsx` + `TextEditorView.tsx`)

```typescript
function MonacoBody({ model }: { model: MonacoEditor }) {
    const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
    const host = model.contentHost as TextFileModel | null;

    const { content, language, encrypted } = host?.state.use((s) => ({
        content: s.content,
        language: s.language,
        encrypted: s.encrypted,
    })) ?? { content: "", language: "plaintext", encrypted: false };

    // ── Drain fire-and-forget events from the editor queue ──────────────
    model.queue.use((ev) => {
        const ed = monacoRef.current;
        if (!ed) return;
        switch (ev.type) {
            case "revealLine":
                ed.revealLineInCenter(ev.line);
                ed.setPosition({ lineNumber: ev.line, column: 1 });
                ed.focus();
                break;
            case "highlightText":
                applyFindMatchDecorations(ed, decorationsRef, ev.text);
                break;
            case "focus":
                ed.focus();
                break;
        }
    });

    // ── Register request/reply handler for view-context queries ─────────
    model.queue.useRequest((req) => {
        const ed = monacoRef.current;
        if (!ed) throw new Error("Monaco not mounted");
        switch (req.type) {
            case "getSelectedText":
                return ed.getModel()?.getValueInRange(ed.getSelection()!) ?? "";
            case "getCursorPosition":
                return ed.getPosition() ?? { lineNumber: 1, column: 1 };
            case "insertText":
                ed.executeEdits("script", [{
                    range: rangeAt(ed.getSelection()!.getStartPosition()),
                    text: req.text,
                    forceMoveMarkers: true,
                }]);
                return undefined;
            case "replaceSelection":
                ed.executeEdits("script", [{ range: ed.getSelection()!, text: req.text, forceMoveMarkers: true }]);
                return undefined;
        }
    });

    const handleMount = useCallback((ed: monaco.editor.IStandaloneCodeEditor) => {
        monacoRef.current = ed;
        setupWheelZoom(ed);
        setupRichPaste(ed, host);
        setupSelectionListener(ed, model);   // writes hasSelection to model.state
        ed.focus();
    }, [model, host]);

    const handleChange = useCallback((value: string | undefined) => {
        host?.changeContent(value ?? "", true);
    }, [host]);

    if (!host) return null;

    return (
        <Editor
            value={content}
            language={language}
            onMount={handleMount}
            onChange={handleChange}
            theme="custom-dark"
            options={{ automaticLayout: true, readOnly: encrypted }}
        />
    );
}
```

**Note**: `MonacoBody` is intentionally tiny — most of today's `TextViewModel` becomes plain `useCallback` / `useRef` inside this component (`setupWheelZoom`, `setupRichPaste`, `setupSelectionListener`, the highlight decoration collection). The `ContentViewModel` superclass + `addSubscription` plumbing retires entirely. Each view-private resource gets a `useEffect` cleanup or rides Monaco's own `IDisposable` lifecycle.

### Wrap-up: full editor view

The editor module exports two pieces — `createEditor` for the registry, and `Component` for `<AsyncEditor>`:

```typescript
// src/renderer/editors/monaco/index.ts (renamed from text/index.ts)
export const monacoModule: EditorModule = {
    createEditor: () => new MonacoEditor(new TComponentState({ ...defaultMonacoEditorState })),
    Component: MonacoEditorView,
};

function MonacoEditorView({ model }: { model: MonacoEditor }) {
    return (
        <TextChrome model={model}>
            <MonacoBody model={model} />
        </TextChrome>
    );
}
```

### `accepts()` (registry)

```typescript
accepts({ host, fileName, language, mode }: AcceptanceInput): number {
    // Monaco is the universal text fallback. Always accepts; priority depends
    // on whether a more specific editor outranks us.
    if (host) return mode === "view" ? 10 : 50;   // mode=view downranks Monaco vs. preview editors
    if (fileName) return mode === "view" ? 10 : 50;
    return 50;
}
```

S5 (walkthrough 02) leaves the exact priority constants flexible; the contract is that Monaco's number is the floor everywhere it's a valid choice. Specific viewer editors (Markdown, PDF, Image, Notebook) return higher priorities for their extensions.

---

## Switch in / out

### Switch in via `switchFrom(oldEditor)`

Called by `PageModel.switchMainEditor` after `editorRegistry.createEditor("monaco")`. Steps inside `MonacoEditor.switchFrom`:

1. Read `CONTENT_HOST_TRAIT` from `oldEditor.traits`. Throws if missing (S7 contract).
2. Call `trait.extractContentHost()` — the trait method nulls out the old editor's `_host` and `_hostStateUnsub` so the old `dispose()` doesn't double-dispose.
3. Verify the returned host is a `TextFileModel`. Throws otherwise (defensive — registry should prevent this).
4. Copy the OLD editor's `id` into our own state (C9 — cache files `<id>-host.txt`, `<id>-monaco.json`, `<id>-script-panel.json` survive the swap because the cache prefix matches).
5. `host.setStorage(this.stateStorage)` — re-bind the host's storage handle to our (now-shared) id so its content cache writes to the same file.
6. `adoptHost(host)` — set `this._host`, subscribe to `host.state` for `descriptorChanged` forwarding, carry forward the title.

After `switchFrom` returns, `restore()` runs:

- `this._host` is already set, so the new-host construction branch is skipped.
- `this._host.state.get().restored === true` (host was already restored under the old editor), so `host.restore()` is skipped — content is preserved.
- `adoptHost` runs idempotently (subscription replaced; title re-read no-op).

The new Monaco view mounts; queue events drain; selection listener attaches; user sees the same content rendered in Monaco's bare-text mode (vs. say Grid's tabular renderer).

### Switch OUT (handing the host to another editor)

When the user switches Monaco → Grid (or any other text-bearing editor), the NEW editor calls `oldMonacoEditor.traits.get(CONTENT_HOST_TRAIT).extractContentHost()`. The trait closure in MonacoEditor's constructor:

1. Asserts `_host !== null` (throws if already extracted).
2. Unsubscribes the host state forwarder.
3. Nulls out `_host`.
4. Returns the host to the new editor.

Then `PageModel.setMainEditor` calls `oldMonacoEditor.dispose()`. Inside dispose:

- `_hostStateUnsub` is already null (no-op).
- `_host` is null — `host.dispose()` is **skipped** (the new editor owns the host now).
- `queue.dispose()` drains any pending events / requests (rejects pending Promises so awaiting facade calls don't hang).

### `dispose()` — Monaco dies, host comes with it

When the user closes the tab without switching, `PageModel.dispose` iterates editors:

- `MonacoEditor.dispose()` runs. `_host !== null` (no extraction happened). `await this._host.dispose()` cleans up `io` watch subscriptions, `script` debounce, `pipe`.
- Page then calls `fs.deleteCacheFiles(monacoEditor.id)` per the C9 cleanup contract — wipes `<id>-host.txt`, `<id>-monaco.json`, `<id>-script-panel.json` from the cache directory.

### ITextModel survival (C3)

Today, Monaco's `monaco.editor.ITextModel` is created internally by `@monaco-editor/react`'s `<Editor value={...}>` wrapper and is auto-disposed when the component unmounts. Under EPIC-028 this is unchanged:

- When Monaco view mounts (initial load or switch-in), `@monaco-editor/react` allocates an `ITextModel` from `host.state.get().content`.
- When Monaco view unmounts (switch-out to Grid), `@monaco-editor/react` disposes the `ITextModel`. **Undo history dies with it.**
- When the user switches Grid → Monaco again, a fresh `ITextModel` is allocated from the (possibly-mutated) host content. No undo history.

C3's resolution accepts this loss: cross-editor undo (undoing Monaco edits while in Grid mode) is a separate future epic. Within the Monaco view, undo/redo works for the duration of that mount.

---

## Lifecycle hooks

| Hook | Override? | Behavior |
|------|-----------|----------|
| `applyRestoreData(data)` | ✅ | Stash `data.host` on `_pendingHost`; forward `revealLine` / `highlightText` to `queue`. Apply `title` / `modified` / `secondaryEditor` to local state. |
| `switchFrom(old)` | ✅ | Extract host via `CONTENT_HOST_TRAIT`; copy old id; rebind storage; adoptHost. Throws if old editor isn't text-bearing. |
| `restore()` | ✅ | Build host from descriptor (or empty), restore host if not already restored, adoptHost. Try/catch with empty-host + `ui.notify` fallback (A7). |
| `saveState()` | ✅ | Delegate to `host.io.saveState()` (drains the IO debounce — pipe cache flush). Awaitable per M3. |
| `beforeNavigateAway(newModel)` | ❌ inherit | Base impl clears `secondaryEditor`. Monaco doesn't have panel contributions, so no-op effectively. |
| `onMainEditorChanged(newMain)` | ❌ inherit | Default no-op. Monaco doesn't react to other editors taking over. |
| `confirmRelease(closing)` | ✅ | Delegate to `host.actions.confirmRelease(closing)`. Asks "Save?" dialog if `host.modified && !host.temp` and not in `skipSave`. |
| `isFreshEmpty()` | ✅ | EW10's four-condition check (empty content, no filePath, not modified, empty title). |
| `getNavigatorTarget()` | ✅ | PT5 / B3 — returns `{ pipe, filePath }` from host so `<PageToolbar>` renders the NavPanel button. |
| `hasTextSelection()` | ✅ | PT7 — returns `state.hasSelection`. Implemented (not `?` optional) for Monaco. |
| `findCompatibleEditors()` | ✅ | Returns `editorRegistry.findEditorsAccepting(this._host)`. |
| `getRestoreData()` | ✅ | `super.getRestoreData()` + `host: this._host?.getDescriptor()`. |
| `getIcon` / `noLanguage` | ❌ inherit | Monaco is the language-picker default; no custom icon. |
| `dispose()` | ✅ | Unsubscribe host forwarder; dispose host iff still owned (not extracted); `super.dispose()` drains queue. |

`beforeNavigateAway` and `onMainEditorChanged` are not overridden because Monaco has no special reaction. The base behavior is appropriate.

---

## Persistence

### `getRestoreData()` output shape

```typescript
{
    editorId: "monaco",
    id: "<uuid>",                  // cache-file prefix
    state: { title, modified, secondaryEditor, hasSelection: false /*reset on restore*/ },
    host: {                        // TextFileModel.getDescriptor()
        kind: "textFile",
        state: {
            id, content: "",       // — large content lives in cache file, not the blob (M9)
            language, filePath, modified, encoding, encrypted, temp,
            // restored: stripped (runtime-only per mockup TextFileModel.getRestoreData)
            // password: deliberately stripped (security)
        },
        pipe: { provider, transformers, encoding },
    },
}
```

**Content stays in the cache file** (`<editor.id>-host.txt`), not in `openFiles.txt`. M9 (walkthrough 05) locked this invariant — the descriptor stays metadata-only to keep IPC payloads small and avoid duplicating large blobs.

### `applyRestoreData(data)` consumption

Two paths into this method:

1. **Open-file flow** (PagesLifecycleModel.navigatePageTo, addEditorPage): caller passes a small partial — e.g. `{ host: { kind: "textFile", state: { filePath, language }, pipe } }`. `restore()` builds a fresh `TextFileModel`, calls `host.restore()` (reads from pipe, populates content).

2. **Session-restore** (PagesPersistenceModel.restorePage, multi-window movePageIn): caller passes the full persisted descriptor's `state` slice + the saved `host` descriptor. `restore()` builds the host via `TextFileModel.fromDescriptor(desc)` (sync), then `host.restore()` (reads cache file `<id>-host.txt` if `modified`, else re-reads from pipe).

Both paths converge in `restore()`. The `_pendingHost` field is the staging area — `applyRestoreData` is sync, `restore` is async; the staging field bridges them.

### `hasSelection` resets on restore

`hasSelection: false` in the saved state is fine — the field is a view-derived runtime fact. On restore Monaco mounts, the selection listener attaches, and `hasSelection` reflects the empty initial selection. We could drop it from the saved blob entirely (it's set to false by default state); resolved in MO5.

### Migration from today's format

Per C2: no migration shim. Walkthrough 04 / P2 + walkthrough 13 / MI3-style detection at boot — old `WindowState` with no `schemaVersion: 4` → `console.warn` + start empty. Within walkthrough 20's scope: no code path translates today's flat `Partial<IEditorState>` into the new `{editorId, id, state, host}` shape.

---

## Scripting

### `TextEditorFacade` collapse

Per SF1 + SF6 — `TextEditorFacade` becomes a thin wrapper over `MonacoEditor`. The 6 view-context methods become async; the 2 fire-and-forget methods stay sync:

```typescript
class TextEditorFacade {
    constructor(private readonly editor: MonacoEditor) {}

    // Fire-and-forget — queue.send under the hood, sync.
    revealLine(line: number): void { this.editor.revealLine(line); }
    setHighlightText(text?: string): void { this.editor.setHighlightText(text); }

    // Request/reply — queue.execute under the hood, async.
    getSelectedText():       Promise<string>                                        { return this.editor.getSelectedText(); }
    getCursorPosition():     Promise<{ lineNumber: number; column: number }>        { return this.editor.getCursorPosition(); }
    insertText(t: string):   Promise<void>                                          { return this.editor.insertText(t); }
    replaceSelection(t: string): Promise<void>                                      { return this.editor.replaceSelection(t); }
}
```

Script authors now write:

```typescript
// today
const text = page.asText().getSelectedText();

// EPIC-028
const text = await page.asText().getSelectedText();
```

Acceptable one-keystroke breaking change for the script API; documented in walkthrough 12 / SF6.

### `page.asText(force?: boolean)`

Per SF1 — `force=true` triggers `page.switchMainEditor("monaco")` if the current main isn't a `MonacoEditor`. Same compatibility source as the UI switch widget (`mainEditor.findCompatibleEditors()`).

### `runScript(all?)` / `runRelatedScript(all?)`

These are host-level, not editor-level — they live on `TextFileActionsModel`. `TextFileActionsModel.runScript` today reads `this.model.getSelectedText()` (the TextFileModel synchronous read via ContentViewModelHost). Under EPIC-028 the synchronous read goes away (the host doesn't have an editor anymore), so the host needs the selection from somewhere.

Options:
- **(a)** Host reads selection via the editor: `actions.runScript` becomes async, calls `editor.getSelectedText()` (queue.execute → view → string). Host needs a back-reference to the editor.
- **(b)** Selection is part of the host signature: `actions.runScript(selectedText?: string)`. Caller passes selection. Chrome's Run button reads `editor.state.get().hasSelection`, and if true asks the editor for the selection string before calling `host.actions.runScript(text)`.
- **(c)** Run-script moves out of the host onto the editor: `MonacoEditor.runScript(all?)`. The host's actions submodel keeps the F5 Ctrl+S / rename keystrokes that don't need selection.

Resolved in MO6.

### Today's `ContentViewModelHost.acquireViewModelSync` for Log View

MCP `mcp-handler.ts` had three sites flipping to `editor instanceof LogViewEditorModel` (walkthrough 13 / MI4). Monaco doesn't have such a site — no external code synchronously acquires the Monaco view-model. Confirmed grep.

---

## Concerns

### MO1 — State decomposition: where does `hasSelection` live?

Today: `TextViewModel.state.hasSelection: boolean` (lives on a ContentViewModel parallel to TextFileModel).

After refactor: TextViewModel dissolves; selection-presence has three candidate homes:

(a) **`MonacoEditor.state.hasSelection`** — one extra field on the editor's state interface; the Monaco view's selection listener writes via `model.state.update(s => s.hasSelection = v)`; chrome reads via `model.state.use(s => s.hasSelection)`. One reactive store; the editor's `hasTextSelection()` reads `state.get().hasSelection` synchronously.

(b) **Separate child `TOneState`** on MonacoEditor (mirrors today's TextViewModel.state but as a side-store rather than a `ContentViewModel` subclass). View writes; chrome reads via the side-store's `use()`. Symmetric with today but keeps editor.state focused on persisted fields.

(c) **Derive on demand via `queue.execute({type:"hasSelection"})`** — async; chrome can't render based on async. Rejected.

**RESOLVED 2026-05-20** — Option (a) confirmed. The `hasSelection` field is a reactive trigger for one chrome button; making it a peer of `title`/`modified` is the minimum primitive. Side-store (b) adds a second reactive surface for one field. The field is non-persisted (resets to false at restore) — handled by `applyRestoreData` not touching it. The `EditorStateBase` interface in `mockups/EditorModel.ts` is the right home for the extension since `MonacoEditorState` declares this field on top of the base.

### MO2 — TextViewModel dissolution: where do `setupWheelZoom`, `setupRichPaste`, `setupSelectionListener` live?

Today: `TextViewModel.setupWheelZoom`, `setupRichPaste`, `setupSelectionListener` — instance methods on the ContentViewModel; lifecycle owned by `addSubscription` + `onDispose`. The ViewModel exists for the duration of the editor mount; today's ContentViewModelHost manages acquire/release.

After refactor: ContentViewModel + ContentViewModelHost retire entirely (SF2). The Monaco view becomes plain React. Three candidates for the setup functions:

(a) **Inline `useEffect`s in `MonacoBody`** — each setup function returns a cleanup callback; the React component owns the lifecycle. `setupWheelZoom(ed) → () => removeWheelListener()`. Idiomatic React.

(b) **A view-private class** (`MonacoBodyController`) constructed once via `useMemo`, disposed via `useEffect` cleanup. Mirrors today's ViewModel shape minus the framework coupling.

(c) **Methods on `MonacoEditor`** — model-level. Wrong scope; the Monaco instance is view-local and dies on every remount (switchFrom in/out).

**RESOLVED 2026-05-20** — Option (a) confirmed. Each setup is a single Monaco binding with a single cleanup; functional `useEffect` is the right shape. A view-private class (b) re-creates today's ViewModel pattern just to be similar, but the actual usage doesn't benefit — the editor instance ref doesn't outlive the component, and there's no model-side observable that consumers subscribe to other than `hasSelection` (which lands on `model.state` per MO1). Encryption-mode `readOnly` toggle (the only mode-reactive setup) is handled at the `<Editor>` props level, not in a setup function.

### MO3 — `monaco.editor.ITextModel` lifecycle

Today: `@monaco-editor/react`'s `<Editor value={content}>` auto-creates the ITextModel; `TextViewModel.handleEditorChange` writes back via `this.host.changeContent(value, true)`. The ITextModel dies and is recreated on every view remount.

After refactor: identical wiring works. The Monaco component is `@monaco-editor/react`'s `<Editor>`; props remain `value={host.content}` / `onChange={(v) => host.changeContent(v ?? "", true)}`. The ITextModel is view-local; switching to Grid kills it; switching back creates a new one. C3 already locked this — undo history dies on switch, accepted tradeoff.

**RESOLVED 2026-05-20** — Option (a) confirmed. No change from today's binding shape. Just route the prop reads through `host.state.use(...)` instead of today's `model.state.use(...)`. The handleEditorChange callback's two-arg shape (`(value, true)` for byUser flag) stays.

### MO4 — Pending operations during switch + first mount

Today: `_pendingRevealLine` / `_pendingHighlightText` fields on `TextFileModel`; consumed by `acquireViewModel` when Monaco mounts.

After refactor (per S4 / B1 mockup): `MonacoQueueEvent` carries them as `{type:"revealLine"} / {type:"highlightText"}` queue.send entries. `applyRestoreData` fires them at restore-stage; the React view's `queue.use(handler)` drains on mount.

What's NEW under walkthrough 20 to confirm: where does the second consumer fire? Today some script-API call paths call `model.revealLine(N)` *after* the editor is already mounted. Under the new shape, those calls go through `MonacoEditor.revealLine(N)` → `queue.send({type:"revealLine", line:N})`. If the view's handler is registered, the queue routes the event to the handler immediately (sync). If not (view is in mid-mount or just unmounted), the event queues. Either way, no behavior regression.

**RESOLVED 2026-05-20** — Option (a) confirmed. Design pinned by S4 / B1. No new mockup work; walkthrough 20 declares the `MonacoQueueEvent` union literally and finalizes the handler closure shape inside `MonacoBody`. No additional state fields needed on `MonacoEditor`.

### MO5 — Persistence shape: drop `hasSelection` from saved state, or keep with default false?

If we keep `hasSelection` in `MonacoEditorState`:
- `applyRestoreData` should explicitly NOT touch it (the value at session-save time is whatever the selection happened to be at the last debounce flush — typically stale and meaningless).
- `getRestoreData` could include it but it's runtime-only.

Two options:

(a) **Keep it in the state interface** (`MonacoEditorState.hasSelection: boolean`); explicitly skip in `applyRestoreData`; explicitly let `getRestoreData` write it (no extra code) — accept a noise field in the persisted blob.

(b) **Move it to a derived non-persistent field** — typed `hasSelection` reactive primitive separate from `state`. View writes via separate channel.

**RESOLVED 2026-05-20** — Option (a) confirmed. Keep `hasSelection` on `state` for the simplest reactive subscription (chrome reads via `state.use`); strip it during persistence by NOT touching it in `applyRestoreData` — default value at fresh-state construction is `false`. Accept the always-false roundtrip; file weight is negligible. Mirrors C7's spirit ("temp" / "restored" stay on host as runtime flags even though they're persisted; same shape).

### MO6 — `runScript` selection access: where does it run from?

Today: `TextFileActionsModel.runScript` reads selection synchronously via `this.model.getSelectedText()` (TextFileModel sync read through ContentViewModelHost.tryGet("monaco")). The synchronous-read mechanism dies under SF2.

Three candidates:

(a) **Async runScript on host**: `TextFileActionsModel.runScript = async (all?) => {...}`. Host gets a back-reference to the editor (set at adoptHost time? At constructor time?). Calls `await editor.getSelectedText()` to get the string. Concern: TextFileModel is one-host-per-editor, but actions today doesn't know the editor.

(b) **Caller passes the selection**: chrome's Run button reads `editor.state.get().hasSelection`, conditionally calls `await editor.getSelectedText()` to materialize the string, then `host.actions.runScript(text)`. Host doesn't need to know about Monaco at all.

(c) **runScript moves to MonacoEditor**: `MonacoEditor.runScript(all?: boolean)` becomes the public API; host's actions only handles F5 plumbing for keyboard. Chrome's Run button calls `editor.runScript(all)`. Notebook's per-note editor (also Monaco-shaped) gets the same method via its own NoteItemEditor's MonacoEditor wrap (walkthrough 29 detail).

**RESOLVED 2026-05-20** — Option (b) confirmed. Cleanest separation — the host stays unaware of selection mechanics; the editor exposes selection via `queue.execute`; the chrome (which already knows both the editor and the host) bridges them. `TextFileActionsModel.runScript(scriptText: string, language: string)` becomes a string-in / dispatch-script-runner method — pure data. Rejected (a) (gives the host a back-reference to the editor, re-introducing the conflation the epic removes); rejected (c) (Run-script is host-level conceptually — "run scripts against this file's content with this file's language"; making it editor-level couples Run-script to Monaco specifically, and Grid/Notebook would need their own Run-script which makes no sense).

F5 keystroke from chrome's `onKeyDown` → `host.handleKeyDown` → `actions.handleKeyDown` → today's branching. The F5 handler inside `actions.handleKeyDown` needs to fetch selection too — same pattern, but the host can't await mid-keystroke (handlers are sync). Resolved: F5 keystroke calls `editor.runScript()` (a new MonacoEditor helper that does the async fetch + delegate-to-host pattern). Effectively MonacoEditor exposes a thin async `runScript(all?)` wrapper that materializes selection then delegates to `host.actions.runScript(text, language)`. Best of both — host stays selection-unaware; chrome stays Monaco-unaware; the one Monaco-aware piece is the MonacoEditor wrapper, which is the natural home.

The F5 routing means `actions.handleKeyDown` shifts — instead of calling `this.runScript()` directly, it needs the editor back-reference for `editor.runScript()`. Cleanest pattern: F5 keystroke is captured by chrome's outer `onKeyDown` (which has `model: EditorModel` in scope), chrome routes Ctrl+S / F2 / Ctrl+Shift+F via `host.handleKeyDown(e)` but routes F5 via `editor.runScript()` directly. The F5 case removes from `actions.handleKeyDown` body. Walkthrough 20 finalizes this split during real-code implementation.

### MO7 — Focus management: `<TextChrome>`'s 200ms root-focus vs. Monaco's internal focus

Today:
- `TextEditorView` subscribes to `pagesModel.onFocus`; on focus, schedules `root.focus()` 200ms later.
- `TextViewModel.onInit` ALSO subscribes to `pagesModel.onFocus`; on focus, schedules `this.focusEditor()` immediately (0ms).

Two independent focus paths. The 200ms delay on the root + 0ms on Monaco is intentional: root focus catches keyboard navigation arrivals; Monaco focus fires only if the editor is mounted (else the focus is captured by the next focusable child on the root panel, naturally Monaco's text area).

After refactor:
- `<TextChrome>` owns the root focus subscription with the 200ms delay (walkthrough 10 / TC8). Confirmed in `mockups/TextChrome.tsx:101-110`.
- Monaco-specific focus needs a new home — chrome doesn't know about Monaco.

Two candidates:

(a) **Monaco-side `onDidFocusEditorText` listener** binds in `handleMount`; whenever Monaco gets focus, fine. The 0ms `focusEditor()` from today retires — Monaco focuses naturally when the user clicks in or tabs to it; the only case it doesn't is "page just became active and Monaco wasn't focused before." Walkthrough 10 / TC8's 200ms root-focus subscribes to `pagesModel.onFocus`; if the root focuses but the focus then escapes to a non-Monaco element, Monaco doesn't grab back.

(b) **`MonacoQueueEvent.focus`** — chrome's 200ms `setTimeout(() => root.focus())` is extended (in walkthrough 10 / TC8) to also call `editor.queue.send({type:"focus"})`. The view's queue handler calls `monacoRef.current?.focus()`. Reproduces today's two-tier focus precisely (root first, Monaco follows).

**RESOLVED 2026-05-20** — Option (b) confirmed. Today's behavior is correct (Monaco gets focus when the page activates); reproducing it explicitly via the queue is the minimal change. Adds one event type to the union; adds one line to chrome's focus subscription. Adds zero state, zero subscriptions.

To keep chrome editor-agnostic (can't compile-check each editor's queue union), the base `EditorModel` gains a `focus(): void { /* override */ }` no-op method. Text-bearing editors override to `this.queue.send({type:"focus"})`; non-text-bearing editors (PDF, Image, Browser, …) inherit the no-op and handle focus internally via their own React widgets. Chrome calls `editor.focus()` unconditionally after the 200ms root-focus `setTimeout`. **Mockup edit landed**: `focus(): void { /* override */ }` no-op added to `mockups/EditorModel.ts` between `hasTextSelection?()` and `saveState()`.

### MO8 — Script panel ownership confirmation

TC6 (walkthrough 10) resolved: script panel is host-owned, not editor-owned. `TextFileModel.script` survives the refactor (walkthrough 12 confirms `host.script` access pattern).

What walkthrough 20 needs to verify: does anything inside `ScriptPanel.tsx` reference editor-side state? Grep of today's `ScriptPanel.tsx`:

- `this.pageModel.runRelatedScript()` — runRelatedScript is on TextFileModel (today, will be on TextFileActionsModel under refactor). Host-level. ✅
- `this.pageModel.state.get().language` — language on TextFileModel today; on TextFileHostState after refactor. Host-level. ✅
- `pagesModel.openFile(selectedScript)` — global pagesModel reference for "Open in New Tab". Not editor-coupled. ✅
- `page.createExplorer(scriptPanelDir)` — `page` is a PageModel reference (via pagesModel.openFile return). Not editor-coupled. ✅
- `page.ensurePageNavigatorModel()` — same. ✅

ScriptPanel.tsx ports verbatim under EPIC-028 with one rename: `model: TextFileModel` (still); `model.script` (still); `model.runRelatedScript()` becomes `model.actions.runRelatedScript()` (a refactor that's already host-internal — TextFileActionsModel was already a submodel).

**RESOLVED 2026-05-20** — Confirmation. ScriptPanel.tsx moves under the host conceptually but stays as a single `.tsx` file with no rewrites beyond reading `state.use((s) => s.language)` from `host.state` instead of `model.state`. The single internal rename `model.runRelatedScript()` → `model.actions.runRelatedScript()` is a host-internal refactor — `TextFileActionsModel` was already a submodel on TextFileModel. No mockup change required.

### MO9 — Content-based editor detection retirement

Today: `TextFileModel` has `_detectTimer`, `scheduleDetection`, `cancelDetection`, `detectContentEditor`, plus `state.detectedContentEditor` field. The timer fires 2500ms after each content change; the detected editor lights up in the switch widget as an extra option.

Per the mockup `TextFileModel` notes (lines 49-55) and `editorRegistry` notes (lines 62-80), this machinery retires:
- `state.detectedContentEditor` field removed.
- `_detectTimer` removed.
- `scheduleDetection` / `cancelDetection` / `detectContentEditor` removed.
- `editorRegistry.findEditorsAccepting(host)` is called on-demand (e.g., when chrome renders the switch widget, when user opens a context menu) and can peek at `host.state.get().content` per the `accepts()` contract that lets editors return non-negative priority based on content markers.

Walkthrough 20's scope: confirm Monaco's `accepts()` doesn't need to detect anything — Monaco is the universal text fallback, accepts everything text-bearing with a floor priority (per the `accepts()` sketch above). Other editors (Notebook, Grid) read `host.state.get().content` for strong content markers.

**RESOLVED 2026-05-20** — Option (a) confirmation. All five today-fields/methods delete from `TextFileModel` (`_detectTimer`, `detectContentEditor`, `scheduleDetection`, `cancelDetection`, `state.detectedContentEditor`). Walkthrough 22 (preview group) revisits whether Markdown/HTML/SVG/Mermaid need on-demand `accepts()` content peeks for their non-extension-based detection (.md without extension, raw HTML strings, etc.); walkthrough 29 (notebook) confirms its `content.startsWith('{"type":"notebook"')` content peek. No mockup change required.

### MO10 — Multi-file rename impact on `id` / cache files

Today: `TextFileModel.applyRenamedPath(newPath)` updates `filePath`/`title`, swaps the pipe to point at the new file, recreates the cache pipe. The cache file `<editor.id>-host.txt` (under refactor; today it's a per-model cache file) survives because `id` doesn't change — only `filePath` does.

After refactor: identical behavior. `MonacoEditor.id` stays; `TextFileModel.state.filePath` / `state.title` change; host's pipe and cache pipe recreate. Inside the host's `io.applyRenamedPath`. No editor-side change.

**RESOLVED 2026-05-20** — Confirmation. Verbatim port. `MonacoEditor.id` stays unchanged across file renames; `TextFileModel.state.filePath` / `state.title` change inside the host's `io.applyRenamedPath` body. Pipe + cache pipe recreate under the new path; cache file `<editor.id>-host.txt` survives because the editor's id is the cache prefix (C9) and doesn't change. No editor-side code change; the rename is fully a host-internal mutation. No mockup change required.

---

## Mockup adjustments

**One tiny edit landed** (MO7):

- **`mockups/EditorModel.ts`** — `focus(): void { /* override */ }` no-op method added between `hasTextSelection?()` and `saveState()`. Header comment block extended with a "Updated by walkthrough 20 (MO7)" entry describing the chrome → editor focus signal under the host split. Text-bearing editors override to `this.queue.send({type:"focus"})`; non-text-bearing editors (PDF, Image, Browser, …) inherit the no-op and handle focus internally.

No other mockup changes. MO1 / MO2 / MO3 / MO5 / MO8 / MO10 are all editor-internal-state or doc-only resolutions; MO4 / MO9 are confirmations of upstream Tier 1–4 resolutions (S4 / B1; mockup `TextFileModel` and `editorRegistry` notes); MO6 lands the runScript split entirely at the real-code layer (no mockup signature changes — `TextFileActionsModel.runScript` is in real-code only, never modeled in `mockups/`).

---

## Migration scope

Real-code only (carried to implementation):

- **New files**:
  - `src/renderer/editors/monaco/MonacoEditor.ts` — `MonacoEditor` class + `MonacoEditorState` + `MonacoQueueEvent` + `MonacoQueueRequest` unions.
  - `src/renderer/editors/monaco/MonacoBody.tsx` — Monaco view component. Replaces today's `TextEditor.tsx`.
  - `src/renderer/editors/monaco/index.ts` — Editor module export (`createEditor` + `Component`).

- **Renamed files**:
  - `src/renderer/editors/text/` → `src/renderer/editors/monaco/` (folder renamed to reflect the editor's actual identity now that the host has moved out).
  - `TextEditorModel.ts` deletes; `TextFileModel` host class moves into a new shared location (`src/renderer/api/content/TextFileModel.ts` or similar — final path picked during implementation; the type goes under a content-host folder rather than under any one editor's folder since multiple editors share it). Submodels (`TextFileIOModel`, `TextFileEncryptionModel`, `TextFileActionsModel`, `ScriptPanel`) move with it.

- **Deleted files**:
  - `TextEditor.tsx` (TextViewModel + view function — dissolves into `MonacoBody.tsx`).
  - `TextEditorView.tsx` (wrapper — dissolves into `<TextChrome>` composition in `MonacoEditorView`).
  - `ActiveEditor.tsx` (dispatcher — retires per TC11 / S10; encryption read-only handled by `<Editor options.readOnly>` in MonacoBody).
  - `TextToolbar.tsx` (per walkthrough 09 + 10).
  - `TextFooter.tsx` (per walkthrough 10).
  - `src/renderer/editors/base/ContentViewModel.ts` + `ContentViewModelHost.ts` + `useContentViewModel.ts` (per SF2).

- **Edited files**:
  - `src/renderer/editors/register-editors.ts` — register `monaco` instead of `textFile` (one line).
  - `src/renderer/editors/registry.ts` — flips to the new mockup shape; absorbs `validateForLanguage` / `getSwitchOptions` / `detectContentEditor` / `getPreviewEditor` deletions per S5 + mockup notes.
  - `TextFileIOModel.ts` / `TextFileEncryptionModel.ts` / `TextFileActionsModel.ts` — submodels port verbatim, but the `this.model` reference becomes `this.host` (typed `TextFileModel`); editor-only fields stripped from the type.
  - `ScriptPanel.tsx` — verbatim port; `model: TextFileModel` (now the host class, not the editor); `model.runRelatedScript()` becomes `model.actions.runRelatedScript()`.
  - `paste-rich-text.ts` — verbatim, used by `setupRichPaste` inside `MonacoBody`.

- **Persistence migration**: zero — major version bump per C2 + P2 + walkthrough 04 / P10. Old `WindowState` without `schemaVersion: 4` → `console.warn` + start empty; per-page restore failures stay non-fatal.

- **Scripting facade**: `src/renderer/scripting/api-wrapper/TextEditorFacade.ts` thins to the SF6 shape — six methods (4 async, 2 sync) over `MonacoEditor`.

- **Persistence helper**: `TextFileModel.fromDescriptor(desc)` (static, sync) — already specified in the IContentHost mockup convention.

---

## Closure

All ten concerns RESOLVED 2026-05-20. One tiny mockup edit landed (MO7).

Final outcomes by concern:

| # | Resolution | Mockup change |
|---|------------|---------------|
| MO1 | (a) — `hasSelection` on `MonacoEditor.state` | none |
| MO2 | (a) — inline `useEffect`s in `MonacoBody` | none |
| MO3 | (a) — `@monaco-editor/react`'s `<Editor>` props unchanged | none |
| MO4 | (a) — confirmation; pinned by S4 / B1 | none |
| MO5 | (a) — keep `hasSelection: false` in saved state; skip in applyRestoreData | none |
| MO6 | (b) — chrome materializes selection then calls `host.actions.runScript(text, language)`; `MonacoEditor.runScript(all?)` wraps for F5 keystroke path | none |
| MO7 | (b) — `MonacoQueueEvent.focus` + base `EditorModel.focus()` no-op | **landed**: `focus(): void { /* override */ }` added to `mockups/EditorModel.ts` |
| MO8 | confirmation — ScriptPanel verbatim port | none |
| MO9 | confirmation — detection machinery deletes | none |
| MO10 | confirmation — applyRenamedPath verbatim | none |

Tier 5 opener confirms the template holds. Following walkthroughs (21 — Grid, 22 — Preview group, etc.) reuse this shape with their own state slices, queue unions, and `accepts()` predicates. The template per text-bearing editor walkthrough:

1. State slice — `<X>EditorState extends EditorStateBase` (most need only a few extra fields).
2. Queue unions — `<X>QueueEvent` (fire-and-forget commands) and optionally `<X>QueueRequest` (view-context queries).
3. View component — wraps the editor's body inside `<TextChrome>`; drains `queue.use(...)` + (if queries) `queue.useRequest(...)`.
4. `accepts()` predicate — strong-content peek for the editor's format markers; floor priority returns -1 (true incompatible) only when it can't render at all.
5. Lifecycle overrides — `switchFrom` (extract host via `CONTENT_HOST_TRAIT`); `restore` (build host or adopt; subscribe to host state for `descriptorChanged`); `dispose` (only dispose host if not extracted).
6. Persistence — `getRestoreData` returns `EditorDescriptor` with `host: this._host?.getDescriptor()`; `applyRestoreData` stages `_pendingHost` + translates pending-operation fields to `queue.send(...)`.
7. Optional overrides — `isFreshEmpty()` (Monaco only); `getNavigatorTarget()` (file-explorer-aware editors); `hasTextSelection()` (Monaco only — selection-aware); `focus()` (all text-bearing editors override to `queue.send({type:"focus"})`).
8. CONTENT_HOST_TRAIT — constructor registers the trait with an `extractContentHost()` closure that nulls out the editor's host reference.

Walkthrough 21 (Grid) is next — exercises the template for the first time on a non-Monaco editor.
