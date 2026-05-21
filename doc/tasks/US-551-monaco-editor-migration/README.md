# US-551 — Monaco / Text editor migration (EPIC-028 Phase C, walkthrough 20)

**Epic:** [EPIC-028: Unified Editor Architecture](../../epics/EPIC-028.md)
**Walkthrough:** [walkthroughs/20-monaco.md](../../epics/EPIC-028-editor-architecture/walkthroughs/20-monaco.md)
**Phase:** C — Per-editor migrations, risk-first (first one — sets the Tier-5 template)
**Status:** Ready to implement (all 11 concerns resolved 2026-05-21)

## Goal

Replace the in-place "Monaco view of legacy `TextFileModel`" with a native v4 `MonacoEditor` (subclass of `v4/EditorModel`). The new editor wraps the existing legacy `TextFileModel` as its `IContentHost`, drives its own React surface via `<TextChrome><MonacoBody/></TextChrome>`, and exchanges model ↔ view messages through `ComponentQueue` instead of the legacy `ContentViewModelHost` / `TextViewModel` quartet.

The migration also lights up the bidirectional switch path between v4-native Monaco and legacy-adapter content-views (Grid / Markdown / Mermaid / SVG / HTML / Notebook / Todo / Link / Log / Rest / Graph / Draw) by adding `CONTENT_HOST_TRAIT` to `LegacyEditorAdapter` and a cross-camp branch in `PageModel.switchMainEditor`.

User-visible outcome: the Monaco tab opens, edits, saves, switches, restores, and survives multi-window transfer identically to today — but the script API `page.asText()` becomes async on its four query methods (`getSelectedText`, `getCursorPosition`, `insertText`, `replaceSelection`) per SF6.

## Background

### Today's shape (`src/renderer/editors/text/`)

Eight files implement "the text editor" — a single class doing both editor and host work:

| File | Role |
|------|------|
| `TextEditorModel.ts` | `TextFileModel extends EditorModel<TextFileEditorModelState, void>` — page tab + `IContentHost`. The conflated class. |
| `TextEditor.tsx` | `TextViewModel extends ContentViewModel<TextEditorState>` — wraps Monaco's `IStandaloneCodeEditor`. View `<TextEditor>` reads `useContentViewModel<TextViewModel>(model, "monaco")`. |
| `TextEditorView.tsx` | Resolves `mainEditorV4`, delegates to `<TextChrome>` for any adapter-wrapped text editor. Internal body is `<ActiveEditor>`. |
| `ActiveEditor.tsx` | Dispatcher — reads `state.editor` (legacy discriminator). Falls back to `<TextEditor>` when `encrypted === true`. |
| `TextFileIOModel.ts` / `TextFileEncryptionModel.ts` / `TextFileActionsModel.ts` | Submodels on `TextFileModel`. Reference `this.model` as the dual editor-and-host. |
| `ScriptPanel.tsx` | Host-owned script library panel. Reads `model.script` + `model.runRelatedScript()`. |
| `paste-rich-text.ts` | Pure helper, view-only. |

### Strangler-fig state after US-547–US-550

- `v4/EditorModel` base lives at `src/renderer/editors/base/v4/EditorModel.ts`. Owns `ComponentQueue`, `TraitSet`, `descriptorChanged`, lifecycle hooks (`switchFrom`, `restore`, `applyRestoreData`, `beforeNavigateAway`, `onMainEditorChanged`, `focus`, `dispose`).
- `v4/LegacyEditorAdapter` wraps every legacy editor today. `editorId` is derived from `legacy.state` via `deriveEditorId`. Its `contentHost` getter duck-casts the wrapped legacy `TextFileModel` to `IContentHost` (the legacy class already exposes the interface's contract). **No `CONTENT_HOST_TRAIT`** in `traits` yet, and `switchFrom()` throws.
- `v4/editorRegistry.ts` has every legacy entry mirrored, but each `loadModule()` factory throws — `PageModel.switchMainEditor` short-circuits to `legacy.changeEditor()` for legacy↔legacy switches via `PageToolbar.onSwitch` (`register-editors.ts:728-759`).
- `<TextChrome>` (`v4/TextChrome.tsx`) is in production for adapter-wrapped Monaco / Grid / Markdown / etc. Reads the host duck-typed; mounts `<PageToolbar>` + body + `<ScriptPanel>` + footer + overlay-ref. Owns the 200ms refocus on `pagesModel.onFocus` (TC8).
- `<PageToolbar>` (`v4/PageToolbar.tsx`) renders the NavPanel button + children + spacer + `<SwitchWidget>`. `onSwitch` branches on `model instanceof LegacyEditorAdapter`.
- `PageModel.switchMainEditor(newId)` calls `editorRegistry.createEditor(newId).switchFrom(oldEditor).restore() → setMainEditor` — but only v4-native editors can be the new editor today, and there are none.
- `PageModel.mainEditor` getter auto-unwraps `LegacyEditorAdapter.legacy`; v4 callers use `mainEditorV4`. `RenderEditor.tsx` reads `model.state.type` (legacy) to choose between `<TextEditorView>` and standalone-`AsyncEditor`.
- Persistence (`PagesPersistenceModel.restoreV4`) iterates `desc.editors`, calls `lifecycle.newEditorModelFromState(legacyState)` + `legacy.applyRestoreData() + legacy.restore()`, then wraps in `LegacyEditorAdapter`.
- Script wrapping (`PageWrapper.asText`) calls `model.acquireViewModel("monaco") as TextViewModel`, hands it to `TextEditorFacade` which calls sync methods (`vm.getSelectedText()` etc.).

### v4 foundation already in place

- `IContentHost` (`v4/IContentHost.ts`) — slimmed: `id`, `state` (`content` + `language?`), `changeContent`, `changeLanguage`, `setStorage`, `dispose`, `getDescriptor`, optional `handleKeyDown`.
- `EditorStateStorage` (`v4/EditorStateStorage.ts`) — `(name) => Promise<string|undefined>` shape (id captured at construction).
- `ComponentQueue` (`core/state/ComponentQueue.ts`) — fire-and-forget + request/reply mailbox. `send`/`subscribe`/`use` + `execute`/`register`/`useRequest`. `dispose()` drops pending events and rejects pending requests.
- `CONTENT_HOST_TRAIT` (`v4/editor-traits.ts`) — `extractContentHost(): IContentHost` closure.
- `EditorStateBase` widens `Omit<Partial<IEditorState>, "id"|"title"|"modified">` with required `id`, `title`, `modified`, optional `secondaryEditor` — adequate for a Monaco-state subclass.
- `persistence-v4.ts` (`shared/persistence-v4.ts`) — `HostDescriptor { kind: "textFile"; state; pipe? }`, `EditorDescriptor { editorId; id; state; host? }`, `PageDescriptor { id; pinned; modified; mainEditorId; editors[]; sidebar? }`, `WindowState { schemaVersion: 4; ... }`.

### Notebook per-note Monaco is independent

`NoteItemEditModel` / `NoteEditorModel` (`editors/notebook/note-editor/`) own their own per-note Monaco binding. **Not migrated by US-551** — Notebook gets its own EditorModel + NoteItemEditModel rework in US-557.

## Implementation plan

### Step 1 — Create `MonacoEditor` and `MonacoBody` (the new files)

**New folder** `src/renderer/editors/monaco/` with three files. Walkthrough 20 envisions `text/` → `monaco/` rename, but that rename would touch 13 sibling content-view editors that still import from `text/`. **Defer the rename to US-559**; create the new folder alongside `text/` instead.

`src/renderer/editors/monaco/MonacoEditor.ts`:

```typescript
import { TComponentState } from "../../core/state/state";
import { EditorModel as V4EditorModel, type EditorStateBase, type RestoreData } from "../base/v4/EditorModel";
import { CONTENT_HOST_TRAIT, type IContentHostTrait } from "../base/v4/editor-traits";
import type { IContentHost } from "../base/v4/IContentHost";
import type { ComponentQueueEvent } from "../../core/state/ComponentQueue";
import type { ComponentQueue } from "../../core/state/ComponentQueue";
import { fpBasename } from "../../core/utils/file-path";
import type { EditorDescriptor, HostDescriptor } from "../../../shared/persistence-v4";
import type { IContentPipe } from "../../api/types/io.pipe";
import { ui } from "../../api/ui";
import { TextFileModel } from "../text/TextEditorModel";          // legacy class — still our host
import { editorRegistry as v4Registry } from "../base/v4/editorRegistry";

export type MonacoQueueEvent =
    | { type: "revealLine"; line: number }
    | { type: "highlightText"; text: string | undefined }
    | { type: "focus" };

export type MonacoQueueRequest =
    | { type: "getSelectedText" }
    | { type: "getCursorPosition" }
    | { type: "insertText"; text: string }
    | { type: "replaceSelection"; text: string };

export interface MonacoEditorState extends EditorStateBase {
    hasSelection: boolean;
}

export const defaultMonacoEditorState: MonacoEditorState = {
    id: "",
    title: "",
    modified: false,
    secondaryEditor: undefined,
    hasSelection: false,
};

export class MonacoEditor extends V4EditorModel<MonacoEditorState, void, MonacoQueueEvent> {
    readonly editorId = "monaco";

    private _host: TextFileModel | null = null;
    private _hostStateUnsub: (() => void) | null = null;
    private _pendingHost: HostDescriptor | undefined = undefined;

    // queue typed for request channel
    readonly queue: ComponentQueue<MonacoQueueEvent, MonacoQueueRequest>;

    constructor(state: TComponentState<MonacoEditorState>) {
        super(state);
        this.queue = this.queue as unknown as ComponentQueue<MonacoQueueEvent, MonacoQueueRequest>;
        const trait: IContentHostTrait = {
            extractContentHost: (): IContentHost => {
                const host = this._host;
                if (!host) throw new Error("Host already extracted from MonacoEditor");
                this._hostStateUnsub?.();
                this._hostStateUnsub = null;
                this._host = null;
                return host as unknown as IContentHost;
            },
        };
        this.traits.set(CONTENT_HOST_TRAIT, trait);
    }

    // ── Host accessors ──────────────────────────────────────────────────
    get contentHost(): IContentHost | null {
        return (this._host as unknown as IContentHost) ?? null;
    }

    findCompatibleEditors(): string[] {
        if (!this._host) return [];
        return v4Registry.findEditorsAccepting(this._host as unknown as IContentHost);
    }

    isFreshEmpty(): boolean {
        const h = this._host;
        if (!h) return false;
        const hs = h.state.get();
        return hs.content === "" && hs.filePath === undefined && !hs.modified && this.state.get().title === "";
    }

    getNavigatorTarget(): { pipe?: IContentPipe | null; filePath?: string | null } | null {
        if (!this._host) return null;
        const { filePath } = this._host.state.get();
        const pipe = this._host.pipe;
        if (!pipe && !filePath) return {};
        return { pipe, filePath };
    }

    hasTextSelection(): boolean {
        return this.state.get().hasSelection;
    }

    focus(): void { this.queue.send({ type: "focus" }); }

    // ── Typed queue wrappers ────────────────────────────────────────────
    revealLine(line: number): void { this.queue.send({ type: "revealLine", line }); }
    setHighlightText(text: string | undefined): void { this.queue.send({ type: "highlightText", text }); }
    focusEditor(): void { this.queue.send({ type: "focus" }); }
    async getSelectedText(): Promise<string> {
        return await this.queue.execute({ type: "getSelectedText" }) as string;
    }
    async getCursorPosition(): Promise<{ lineNumber: number; column: number }> {
        return await this.queue.execute({ type: "getCursorPosition" }) as { lineNumber: number; column: number };
    }
    async insertText(text: string): Promise<void> {
        await this.queue.execute({ type: "insertText", text });
    }
    async replaceSelection(text: string): Promise<void> {
        await this.queue.execute({ type: "replaceSelection", text });
    }

    /** Chrome F5 / Run button entry point. Materializes selection then
     *  delegates to host.actions.runScriptWith — host stays unaware of
     *  Monaco-specific selection mechanics. */
    async runScript(all = false): Promise<void> {
        if (!this._host) return;
        const { content, language } = this._host.state.get();
        let scriptText = content;
        if (!all) {
            const selected = await this.getSelectedText();
            if (selected) scriptText = selected;
        }
        this._host.actions.runScriptWith(scriptText, language ?? "");
    }

    // ── Persistence ─────────────────────────────────────────────────────
    getRestoreData(): EditorDescriptor {
        const s = this.state.get();
        return {
            editorId: this.editorId,
            id: s.id,
            state: { title: s.title, modified: s.modified, secondaryEditor: s.secondaryEditor } as Record<string, unknown>,
            host: this._host?.getDescriptor(),
        };
    }

    applyRestoreData(data: RestoreData<MonacoEditorState>): void {
        this.state.update((cur) => {
            if (data.title !== undefined) cur.title = data.title;
            if (data.modified !== undefined) cur.modified = data.modified;
            if (data.secondaryEditor !== undefined) cur.secondaryEditor = data.secondaryEditor;
        });
        if (data.host) this._pendingHost = data.host;
        if (data.revealLine !== undefined) this.queue.send({ type: "revealLine", line: data.revealLine });
        if (data.highlightText !== undefined) this.queue.send({ type: "highlightText", text: data.highlightText });
    }

    // ── Three-phase lifecycle ──────────────────────────────────────────
    switchFrom(oldEditor: V4EditorModel): void {
        const trait = oldEditor.traits.get(CONTENT_HOST_TRAIT);
        if (!trait) throw new Error(`MonacoEditor.switchFrom: ${oldEditor.editorId} has no CONTENT_HOST_TRAIT`);
        const host = trait.extractContentHost() as unknown as TextFileModel;
        if (!isLegacyTextFileModel(host)) {
            throw new Error("MonacoEditor.switchFrom: extracted host is not a TextFileModel");
        }
        // C9 — preserve cache-file id across the swap.
        this.state.update((s) => { s.id = oldEditor.id; });
        // Re-write the host's state.editor so legacy sub-consumers (ScriptPanel,
        // IO, actions) keep seeing the same discriminator they always have.
        host.state.update((s) => { s.editor = "monaco"; });
        this.adoptHost(host);
    }

    async restore(): Promise<void> {
        try {
            if (!this._host) {
                if (this._pendingHost) {
                    this._host = await TextFileModel.fromDescriptor(this._pendingHost);
                } else {
                    const { newTextFileModel } = await import("../text/TextEditorModel");
                    this._host = newTextFileModel("");
                }
            }
            if (!this._host.state.get().restored) {
                await this._host.restore();
            }
            this.adoptHost(this._host);
        } catch (err) {
            ui.notify((err as Error).message || "Failed to restore Monaco editor.", "error");
            const { newTextFileModel } = await import("../text/TextEditorModel");
            this._host = newTextFileModel("");
            this.adoptHost(this._host);
        }
        this._pendingHost = undefined;
    }

    private adoptHost(host: TextFileModel): void {
        this._host = host;
        this._hostStateUnsub?.();
        this._hostStateUnsub = host.state.subscribe(() => this.descriptorChanged.send(undefined));
        const { filePath, title } = host.state.get();
        this.state.update((s) => {
            s.title = title || (filePath ? fpBasename(filePath) : s.title || "untitled");
        });
        host.state.update((s) => { s.editor = "monaco"; });
        // Mirror page reference so legacy actions/io/script see the page when
        // they call `this.model.page`. (Legacy editors store page on the
        // class; the host IS a legacy editor here.)
        host.setPage(this.page);
    }

    setPage(page: import("../../api/pages/PageModel").PageModel | null): void {
        super.setPage(page);
        this._host?.setPage(page);
    }

    // ── Reaction hooks — delegate to host (legacy editor surface) ───────
    async confirmRelease(closing?: boolean): Promise<boolean> {
        return this._host ? this._host.confirmRelease(closing) : true;
    }

    async saveState(): Promise<void> {
        await this._host?.io.saveState();
    }

    async dispose(): Promise<void> {
        this._hostStateUnsub?.();
        this._hostStateUnsub = null;
        if (this._host) {
            await this._host.dispose();
            this._host = null;
        }
        await super.dispose();
    }
}

function isLegacyTextFileModel(host: unknown): host is TextFileModel {
    const t = (host as { type?: string } | null)?.type;
    return t === "textFile";
}
```

`src/renderer/editors/monaco/MonacoBody.tsx`:

```typescript
import { Editor } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import styled from "@emotion/styled";

import type { MonacoEditor } from "./MonacoEditor";
import type { TextFileModel } from "../text/TextEditorModel";
import { api } from "../../../ipc/renderer/api";
import { convertHtmlToMarkdown, readClipboardHtml } from "../text/paste-rich-text";

const MonacoBodyRoot = styled.div({
    flex: "1 1 auto",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
});

interface MonacoBodyProps { model: MonacoEditor }

export function MonacoBody({ model }: MonacoBodyProps) {
    const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
    const host = model.contentHost as TextFileModel | null;

    const sliced = host?.state.use((s) => ({
        content: s.content,
        language: s.language,
        encrypted: s.encrypted,
    })) ?? { content: "", language: "plaintext", encrypted: false };

    // Drain fire-and-forget events.
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

    // Request/reply handlers.
    model.queue.useRequest((req) => {
        const ed = monacoRef.current;
        if (!ed) throw new Error("Monaco not mounted");
        switch (req.type) {
            case "getSelectedText": {
                const sel = ed.getSelection();
                if (!sel || sel.isEmpty()) return "";
                return ed.getModel()?.getValueInRange(sel) ?? "";
            }
            case "getCursorPosition": {
                const p = ed.getPosition();
                return p ? { lineNumber: p.lineNumber, column: p.column } : { lineNumber: 1, column: 1 };
            }
            case "insertText": {
                const sel = ed.getSelection();
                if (!sel) return undefined;
                ed.executeEdits("script", [{
                    range: new monaco.Range(sel.startLineNumber, sel.startColumn, sel.startLineNumber, sel.startColumn),
                    text: req.text,
                    forceMoveMarkers: true,
                }]);
                return undefined;
            }
            case "replaceSelection": {
                const sel = ed.getSelection();
                if (!sel) return undefined;
                ed.executeEdits("script", [{ range: sel, text: req.text, forceMoveMarkers: true }]);
                return undefined;
            }
        }
    });

    const handleMount = useCallback((ed: monaco.editor.IStandaloneCodeEditor) => {
        monacoRef.current = ed;
        const cleanups: (() => void)[] = [];
        cleanups.push(setupWheelZoom(ed));
        cleanups.push(setupSelectionListener(ed, model));
        cleanups.push(setupRichPaste(ed, host));
        ed.focus();
        // Drain teardown on unmount via a ref-stored array; React Editor unmount
        // disposes the IStandaloneCodeEditor itself, but our IDisposable handles
        // (selection listener, paste action) need explicit cleanup.
        (ed as unknown as { __monacoBodyCleanups?: (() => void)[] }).__monacoBodyCleanups = cleanups;
    }, [model, host]);

    useEffect(() => {
        return () => {
            const ed = monacoRef.current as (monaco.editor.IStandaloneCodeEditor & { __monacoBodyCleanups?: (() => void)[] }) | null;
            ed?.__monacoBodyCleanups?.forEach((fn) => fn());
            monacoRef.current = null;
        };
    }, []);

    const handleChange = useCallback((value: string | undefined) => {
        host?.changeContent(value ?? "", true);
    }, [host]);

    if (!host) return null;

    return (
        <MonacoBodyRoot>
            <Editor
                value={sliced.content}
                language={sliced.language}
                onMount={handleMount}
                onChange={handleChange}
                theme="custom-dark"
                options={{ automaticLayout: true, readOnly: !!sliced.encrypted }}
            />
        </MonacoBodyRoot>
    );
}

// ── Private setup helpers (each returns a teardown closure) ─────────────

function setupWheelZoom(ed: monaco.editor.IStandaloneCodeEditor): () => void {
    const dom = ed.getDomNode();
    if (!dom) return () => undefined;
    const handler = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        api.zoom(e.deltaY < 0 ? 0.5 : -0.5);
    };
    dom.addEventListener("wheel", handler, { passive: false, capture: true });
    return () => dom.removeEventListener("wheel", handler, { capture: true });
}

function setupSelectionListener(ed: monaco.editor.IStandaloneCodeEditor, model: MonacoEditor): () => void {
    const sub = ed.onDidChangeCursorSelection(() => {
        const sel = ed.getSelection();
        const has = sel ? !sel.isEmpty() : false;
        if (model.state.get().hasSelection !== has) {
            model.state.update((s) => { s.hasSelection = has; });
        }
    });
    return () => sub.dispose();
}

function setupRichPaste(ed: monaco.editor.IStandaloneCodeEditor, host: TextFileModel | null): () => void {
    if (!host) return () => undefined;
    const action = ed.addAction({
        id: "paste-as-rich",
        label: "Paste as Markdown / HTML",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV],
        run: async () => {
            const language = host.state.get().language;
            if (language !== "markdown" && language !== "html") return;
            const html = await readClipboardHtml();
            if (!html) return;
            const text = language === "html" ? html : await convertHtmlToMarkdown(html);
            const sel = ed.getSelection();
            if (sel) ed.executeEdits("paste", [{ range: sel, text, forceMoveMarkers: true }]);
        },
    });
    return () => action.dispose();
}

function applyFindMatchDecorations(
    ed: monaco.editor.IStandaloneCodeEditor,
    ref: React.MutableRefObject<monaco.editor.IEditorDecorationsCollection | null>,
    text: string | undefined,
): void {
    const model = ed.getModel();
    if (!model) return;
    if (!text?.trim()) { ref.current?.clear(); return; }
    const matches = model.findMatches(text, false, false, false, null, false);
    const decorations: monaco.editor.IModelDeltaDecoration[] = matches.map((m) => ({
        range: m.range,
        options: { className: "findMatch" },
    }));
    if (ref.current) ref.current.set(decorations);
    else ref.current = ed.createDecorationsCollection(decorations);
}
```

`src/renderer/editors/monaco/index.ts`:

```typescript
import { TComponentState } from "../../core/state/state";
import { MonacoEditor, defaultMonacoEditorState } from "./MonacoEditor";
import { MonacoBody } from "./MonacoBody";
import { TextChrome } from "../base/v4/TextChrome";
import type { EditorModule } from "../base/v4/editorRegistry";
import type { EditorModel as V4EditorModel } from "../base/v4/EditorModel";

function MonacoEditorView({ model }: { model: V4EditorModel }) {
    return (
        <TextChrome model={model}>
            <MonacoBody model={model as MonacoEditor} />
        </TextChrome>
    );
}

export const monacoModule: EditorModule = {
    createEditor: () => new MonacoEditor(new TComponentState({ ...defaultMonacoEditorState })),
    Component: MonacoEditorView,
};

export { MonacoEditor };
export type { MonacoEditorState, MonacoQueueEvent, MonacoQueueRequest } from "./MonacoEditor";
```

### Step 2 — Add `getDescriptor` / `fromDescriptor` / `setStorage` to legacy `TextFileModel`

Edit `src/renderer/editors/text/TextEditorModel.ts`:

- Add **`getDescriptor(): HostDescriptor`** that returns `{ kind: "textFile", state: <flat metadata>, pipe: this.pipe?.toDescriptor() }`. Mirror today's `getRestoreData()` but wrap as a HostDescriptor.
- Add **`setStorage(storage: EditorStateStorage)`** (v4 shape `(name) => Promise<string|undefined>`). Adapter for cache-file scope when wrapped by `MonacoEditor`. Legacy callers don't use it; submodels keep using `appFs.getCacheFile(id, name)` directly via `state.id`, so this method can be a no-op stub for US-551 (only kept to satisfy `IContentHost`). Real consumption arrives in US-559 when submodels accept the storage handle.
- Add **`static async fromDescriptor(desc: HostDescriptor): Promise<TextFileModel>`** that constructs a `TextFileModel` via `newTextFileModelFromState(desc.state)` and re-applies the pipe descriptor (`desc.pipe`) via existing `applyRestoreData` pipe-reconstruction logic.
- Existing `applyRestoreData` already handles `data.pipe` reconstruction — re-use it inside `fromDescriptor`.

### Step 3 — Refactor `TextFileActionsModel.runScript` for chrome-materialized selection

Edit `src/renderer/editors/text/TextFileActionsModel.ts`:

- Extract the dispatch-script-runner core into **`runScriptWith(scriptText: string, language: string): Promise<string | undefined>`**:
  ```ts
  runScriptWith = async (scriptText: string, language: string) => {
      if (isScriptLanguage(language)) {
          await scriptRunner.runWithResult(this.model.id, scriptText, this.model, language);
      }
  };
  ```
- Rewrite **`runScript(all?: boolean)`** as a thin caller that materializes selection via legacy `this.model.getSelectedText()` (legacy path — only reached when no MonacoEditor is active) and calls `runScriptWith`. Same for `runRelatedScript`.
- The MonacoEditor.runScript wrapper (Step 1) materializes selection via the queue and calls `runScriptWith` directly — bypassing the legacy sync read.

### Step 4 — Add `CONTENT_HOST_TRAIT` + `switchFrom` to `LegacyEditorAdapter`

Edit `src/renderer/editors/base/v4/LegacyEditorAdapter.ts`:

- **Constructor** — after the existing field-mirror block, if `legacy` is a TextFileModel (`legacy.type === "textFile"`), register the trait:
  ```ts
  if ((legacy as unknown as { type?: string }).type === "textFile") {
      this.traits.set(CONTENT_HOST_TRAIT, {
          extractContentHost: (): IContentHost => {
              const host = this.legacy as unknown as IContentHost;
              this._hostExtracted = true;
              return host;
          },
      });
  }
  ```
- Add a private `_hostExtracted = false` flag.
- **`switchFrom(old: V4EditorModel)`** — change from throw to:
  ```ts
  switchFrom(old: V4EditorModel): void {
      // v4-native MonacoEditor → legacy bridge: extract the host and adopt it
      // as our legacy editor. The host IS a TextFileModel (it implements
      // IContentHost AND extends legacy EditorModel during the strangler period).
      const trait = old.traits.get(CONTENT_HOST_TRAIT);
      if (!trait) {
          throw new Error(`LegacyEditorAdapter.switchFrom: ${old.editorId} has no CONTENT_HOST_TRAIT`);
      }
      const host = trait.extractContentHost() as unknown as LegacyEditorModel & { state: typeof this.legacy.state };
      // The bridge createEditor() constructed us with a placeholder legacy — replace.
      // Cache-file id continuity is handled by re-using the host's existing id.
      (this as unknown as { legacy: LegacyEditorModel }).legacy = host;
      (this as unknown as { state: typeof host.state }).state = host.state;
      // Mutate state.editor on the legacy host so legacy ActiveEditor renders
      // the target content-view (grid-json / md-view / etc.). editorId getter
      // re-derives on every read.
      host.state.update((s) => { s.editor = this._pendingEditorId; });
      // Re-subscribe the v4-base descriptorChanged forwarder onto the new state.
      this._reSubscribeDescriptorChanged?.();
  }
  ```
- **Constructor variant for cross-camp create** — accept `_pendingEditorId` second arg already exists (`_editorId` is currently ignored but stored). For US-551 we pass it through to `_pendingEditorId` and consume in `switchFrom`. Update the constructor's body to STORE the second arg as `private readonly _pendingEditorId: string` (the v4 target editorId).
- **`dispose()` honors extracted host** — if `_hostExtracted === true`, do NOT dispose the legacy editor (it's owned by the new v4 editor now). Just drain the queue:
  ```ts
  async dispose(): Promise<void> {
      await super.dispose();   // drains queue
      if (!this._hostExtracted) await this.legacy.dispose();
  }
  ```
- Re-subscribe helper: the base ctor wires `this.state.subscribe(() => descriptorChanged.send())` once. After `switchFrom` swaps `this.state`, the old subscription is on the old state. Store the unsubscribe; in `switchFrom`, re-subscribe on the new state. Add a `private _descriptorUnsub: (() => void) | null = null` and use it.

### Step 5 — Bridge `editorRegistry` for native Monaco + bare-adapter creation for legacy targets

Edit `src/renderer/editors/register-editors.ts`:

- Add **`v4Registry.register({ id: "monaco", ... })` with real `loadModule`** that returns `monacoModule` from `editors/monaco/index.ts`. Place this AFTER the legacy mirror loop so it overrides the throwing stub:
  ```ts
  v4EditorRegistry.register({
      id: "monaco",
      name: "Text Editor",
      hasContentHost: true,
      accepts: (input) => {
          // Universal text fallback — see walkthrough 20 §accepts.
          if (input.fileName) return input.mode === "view" ? 10 : 50;
          if (input.host) return input.mode === "view" ? 10 : 50;
          if (input.language) return input.mode === "view" ? 10 : 50;
          return 50;
      },
      loadModule: async () => {
          const { monacoModule } = await import("./monaco");
          return monacoModule;
      },
  });
  ```
- For every OTHER text-bearing legacy entry (Grid / MD / Mermaid / SVG / HTML / Notebook / Todo / Link / Log / Rest / Graph / Draw — drop the throwing `loadModule` and replace with a **bare-adapter factory**:
  ```ts
  loadModule: async () => ({
      createEditor: () => {
          const placeholder = newTextFileModel("");  // ephemeral; switchFrom replaces
          return new LegacyEditorAdapter(placeholder, legacyDef.id);
      },
      Component: AdapterFallbackComponent,  // re-uses <TextEditorView>
  }),
  ```
  The placeholder is discarded (the host adoption happens in `switchFrom`). Document the contract: the v4 adapter is ONLY usable post-`switchFrom`. `AdapterFallbackComponent` exists for type completeness but is never mounted (the adapter's `loadModule.Component` isn't read by today's `RenderEditor` — see Step 8).

### Step 6 — Cross-camp branch in `PageModel.switchMainEditor`

Edit `src/renderer/api/pages/PageModel.ts`:

- Current `switchMainEditor(newId)` (line 392) calls `editorRegistry.createEditor(newId).switchFrom(oldEditor)`. This now works for `monaco` (Step 5). For OTHER legacy targets:
  - The v4 registry returns a placeholder LegacyEditorAdapter; `adapter.switchFrom(old)` (Step 4) replaces its `legacy` with the extracted host.
- No code change required to `PageModel.switchMainEditor` itself — Step 4 + Step 5 together make the existing flow work for the cross-camp case.
- Double-check: `oldEditor.editorId === newEditorId` short-circuit currently runs `if (oldEditor.editorId === newEditorId) return;` (line 395). For Monaco-already-active + switch-to-monaco, the early return prevents re-creating the editor. Verified correct.

### Step 7 — Update `PageToolbar.onSwitch` to route v4-native through `page.switchMainEditor`

Edit `src/renderer/editors/base/v4/PageToolbar.tsx`:

- Current `onSwitch(model, newId)` (line 94) branches on `model instanceof LegacyEditorAdapter` → `legacy.changeEditor(newId)`. For US-551:
  - **If `model instanceof LegacyEditorAdapter` AND `newId === "monaco"`**: route through `page.switchMainEditor("monaco")` (this creates a v4-native MonacoEditor and extracts the host).
  - **Else if `model instanceof LegacyEditorAdapter`** (legacy → legacy): keep `legacy.changeEditor(newId)` (today's behavior — host-preserving in-place mutation, no editor swap).
  - **Else** (model is v4-native MonacoEditor): always route through `page.switchMainEditor(newId)`. Step 4 + Step 5 build the new adapter wrapping the extracted host.
- Resulting onSwitch:
  ```ts
  function onSwitch(model: EditorModel, newEditorId: string) {
      if (model instanceof LegacyEditorAdapter && newEditorId !== "monaco") {
          const legacy = model.legacy as unknown as { changeEditor?: (v: string) => void };
          legacy.changeEditor?.(newEditorId);
          return;
      }
      void model.page?.switchMainEditor(newEditorId);
  }
  ```

### Step 8 — Update `RenderEditor` + `Pages.tsx` to distinguish v4-native vs legacy

Edit `src/renderer/api/pages/PageModel.ts` and `src/renderer/ui/app/Pages.tsx` + `src/renderer/ui/app/RenderEditor.tsx`:

- `Pages.tsx` currently reads `const editor = page.mainEditor;` (unwrapped legacy). Change to `const editorV4 = page.mainEditorV4;` and pass `editorV4` to `<RenderEditor model={editorV4} />`.
- `RenderEditor` receives a v4 EditorModel. Logic:
  ```tsx
  export function RenderEditor({ model }: { model: V4EditorModel }) {
      // v4-native editor: mount its module's Component.
      if (!(model instanceof LegacyEditorAdapter)) {
          // For now only MonacoEditor is v4-native; route through editorRegistry
          // so future migrations (US-552+) light up without further changes.
          return <AsyncEditor getEditorModule={() => loadV4Module(model.editorId)} model={model} cacheKey={`v4:${model.editorId}`} />;
      }
      // Legacy adapter — keep today's behavior (TextEditorView / standalone AsyncEditor).
      const legacy = model.legacy;
      const type = (legacy.state.get() as { type?: string }).type;
      const editors = editorRegistry.getAll();
      const pageEditor = editors.find((e) => e.editorType === type && e.category === "standalone");
      if (pageEditor) {
          return <AsyncEditor getEditorModule={getPageEditorModule(type!)} model={legacy} cacheKey={type} />;
      }
      return <TextEditorView model={legacy as TextFileModel} />;
  }

  async function loadV4Module(id: string) {
      const def = v4Registry.getById(id);
      if (!def) throw new Error(`No v4 editor for id ${id}`);
      const module = await def.loadModule();
      // Adapt v4 module shape (createEditor + Component) to AsyncEditor's
      // EditorViewModule shape (Editor field).
      return { Editor: module.Component as React.ComponentType<{ model: V4EditorModel }> };
  }
  ```
- `AsyncEditor`'s `model: EditorModel | IContentHost` prop typing already accepts both legacy and content-host; we pass the v4 MonacoEditor (treated as EditorModel by AsyncEditor's pass-through). Add a typing widening if needed (`model: any` in AsyncEditor's prop is acceptable for US-551; tighten in US-559).
- `PageTab.tsx`, `OpenTabsList.tsx`, `PageTabs.tsx` still use `page.mainEditor` (auto-unwrap). For MonacoEditor (not a LegacyEditorAdapter), `mainEditor` falls through `unwrapAdapter` and returns the MonacoEditor cast as a legacy editor — its `state.get()` won't have `type`/`filePath`/`language` directly. Update the unwrap to handle MonacoEditor too:
  - In `PageModel.unwrapAdapter`, add: if `editor instanceof MonacoEditor`, return `editor._host as unknown as LegacyEditorModel` (the legacy TextFileModel). This keeps `editor.state.get().filePath`/`language` working for tab strip consumers.
  - Define a v4 capability check rather than importing MonacoEditor (avoids a circular import): if `editor.contentHost`, return its content host as the legacy model.

### Step 9 — Persistence dual-shape on restore + write

Edit `src/renderer/api/pages/PagesPersistenceModel.ts`:

- **Write side** — `page.getDescriptor().editors[]` already calls `e.getRestoreData()` which is overridden on MonacoEditor (Step 1) to return `{ editorId: "monaco", id, state: <Monaco fields>, host: <HostDescriptor> }`. LegacyEditorAdapter.getRestoreData returns `{ editorId, id, state: legacyState, host: undefined }`. Both shapes co-exist in `WindowState.pages[].editors[]`. No persistence-write change.
- **Read side — `restorePage`** (line 73): branch on whether the descriptor is Monaco-native vs legacy-shaped:
  ```ts
  const editors = await Promise.all(
      desc.editors.map(async (d) => {
          try {
              if (d.editorId === "monaco" && d.host) {
                  // Native MonacoEditor restore path.
                  const { editorRegistry: v4Registry } = await import("../../editors/base/v4");
                  const editor = await v4Registry.createEditor(d.editorId, d.id);
                  editor.applyRestoreData(d as RestoreData<MonacoEditorState>);
                  await editor.restore();
                  return editor;
              }
              // Legacy-shaped descriptor (no host field, or non-monaco editorId).
              const legacyState = { ...(d.state as Partial<IEditorState>), id: d.id };
              const legacy = await this.model.lifecycle.newEditorModelFromState(legacyState);
              legacy.applyRestoreData(legacyState);
              await legacy.restore();
              return new LegacyEditorAdapter(legacy, d.editorId);
          } catch (err) { ... return null; }
      }),
  );
  ```
- **Read side — `restoreV3`** (legacy pre-EPIC-028 sessions) untouched. Old v3 sessions with state.editor === "monaco" are restored as LegacyEditorAdapter; first save afterwards writes the v4 shape with native MonacoEditor's getRestoreData. (Acceptable — the second app launch sees native Monaco entries.)

### Step 10 — Open-file flow creates MonacoEditor for Monaco targets

Edit `src/renderer/api/pages/PagesLifecycleModel.ts`:

- Today `openFile` / `addEmptyPage` / `addEditorPage` build a legacy TextFileModel + wrap in `LegacyEditorAdapter`. Update the wrap step: if the resolved target editor is "monaco" (i.e., `editorRegistry.resolve(filePath).id === "monaco"` or the editor field is undefined/monaco), construct a MonacoEditor wrapping the legacy TextFileModel:
  ```ts
  // After `await legacy.restore()` succeeds:
  const targetEditorId = deriveEditorId(legacy.state.get());
  let editorV4: V4EditorModel;
  if (targetEditorId === "monaco") {
      const { MonacoEditor } = await import("../../editors/monaco");
      const { TComponentState } = await import("../../core/state/state");
      const { defaultMonacoEditorState } = await import("../../editors/monaco/MonacoEditor");
      const monaco = new MonacoEditor(new TComponentState({ ...defaultMonacoEditorState, id: legacy.state.get().id }));
      // Adopt the host directly — no switchFrom needed (no old editor).
      (monaco as unknown as { _host: typeof legacy; adoptHost: (h: typeof legacy) => void }).adoptHost(legacy);
      editorV4 = monaco;
  } else {
      editorV4 = wrap(legacy);
  }
  ```
- Apply this branch in `openFile`, `addEmptyPage`, `addEditorPage`, `addDrawPage`, `requireWellKnownPage`, `navigatePageTo`, `requireGroupedText` — anywhere a TextFileModel is wrapped for the page collection. Centralize in a new helper:
  ```ts
  async function wrapForPage(legacy: LegacyEditorModel): Promise<V4EditorModel> {
      const targetEditorId = deriveEditorId(legacy.state.get());
      if (targetEditorId === "monaco" && (legacy as { type?: string }).type === "textFile") {
          // ... build MonacoEditor wrapping legacy
      }
      return new LegacyEditorAdapter(legacy, targetEditorId);
  }
  ```
- The existing `wrap()` helper (line 40) is folded into `wrapForPage` (sync constructions become async because of dynamic imports — propagate the await).

### Step 11 — `TextEditorFacade` over MonacoEditor

Edit `src/renderer/scripting/api-wrapper/TextEditorFacade.ts`:

```typescript
import type { MonacoEditor } from "../../editors/monaco/MonacoEditor";

export class TextEditorFacade {
    constructor(private readonly editor: MonacoEditor) {}

    get editorMounted(): boolean {
        // Queue-backed — view-mount state is opaque to the model. Treat as
        // always mounted; queue.execute will queue until view mounts.
        return true;
    }

    // Fire-and-forget — sync.
    revealLine(line: number): void { this.editor.revealLine(line); }
    setHighlightText(text?: string): void { this.editor.setHighlightText(text); }

    // Request/reply — async.
    async getSelectedText(): Promise<string> { return this.editor.getSelectedText(); }
    async getCursorPosition(): Promise<{ lineNumber: number; column: number }> { return this.editor.getCursorPosition(); }
    async insertText(text: string): Promise<void> { return this.editor.insertText(text); }
    async replaceSelection(text: string): Promise<void> { return this.editor.replaceSelection(text); }
}
```

Edit `src/renderer/scripting/api-wrapper/PageWrapper.ts`:

- Update `asText(force = false)`:
  ```ts
  async asText(force = false): Promise<TextEditorFacade> {
      await this.ensureEditor("monaco", "Monaco", "asText", force);
      const v4 = this.v4;
      if (!v4 || v4.editorId !== "monaco") {
          throw new Error("asText(): page is not a MonacoEditor after switch");
      }
      // After US-551, v4 main IS a MonacoEditor.
      const { MonacoEditor } = await import("../../editors/monaco/MonacoEditor");
      if (!(v4 instanceof MonacoEditor)) {
          throw new Error("asText(): unexpected v4 editor type");
      }
      return new TextEditorFacade(v4);
  }
  ```
- Drop the `model.acquireViewModel("monaco")` + `releaseList.push(model.releaseViewModel)` path. The facade now holds a stable reference to the editor (which lives as long as the page).

### Step 12 — Update script API types

Edit `src/renderer/api/types/text-editor.d.ts` to make the four query methods async. Mirror the change in `assets/editor-types/text-editor.d.ts` (auto-mirrored via the watcher; should pick up automatically).

```ts
export interface ITextEditor {
    readonly editorMounted: boolean;
    getSelectedText(): Promise<string>;
    revealLine(lineNumber: number): void;
    setHighlightText(text?: string): void;
    getCursorPosition(): Promise<{ lineNumber: number; column: number }>;
    insertText(text: string): Promise<void>;
    replaceSelection(text: string): Promise<void>;
}
```

### Step 13 — TextChrome focus + F5 special-case

Edit `src/renderer/editors/base/v4/TextChrome.tsx`:

- Inside the existing focus subscription useEffect (lines 51-61), after `root.focus()`, call `model.focus()`:
  ```ts
  setTimeout(() => {
      const root = rootRef.current;
      if (root && !root.contains(document.activeElement)) root.focus();
      model.focus();   // queued no-op for non-text editors; sends "focus" event for MonacoEditor
  }, 200);
  ```
- onKeyDown — F5 routes through MonacoEditor:
  ```tsx
  onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.code === "F5" && !textHost?.script.state.get().open) {
          // Monaco-aware Run; chrome materializes selection via the queue.
          if ((model as unknown as { runScript?: (all?: boolean) => Promise<void> }).runScript) {
              e.preventDefault();
              void (model as unknown as { runScript: (all?: boolean) => Promise<void> }).runScript();
              return;
          }
      }
      host.handleKeyDown?.(e);
  }}
  ```
  When ScriptPanel is open, F5 still goes to host.handleKeyDown → `runRelatedScript`.
- Update `RunButtons` in TextChrome to also use the new path when the model has `runScript`:
  ```tsx
  function RunButtons({ model, host }: { model: EditorModel; host: TextFileModel }) {
      const language = host.state.use((s) => s.language);
      if (!isScriptLanguage(language)) return null;
      const hasSelection = model.hasTextSelection?.() ?? false;
      const m = model as unknown as { runScript?: (all?: boolean) => Promise<void> };
      const runViaEditor = m.runScript !== undefined;
      const onRun = () => runViaEditor ? void m.runScript!(false) : host.runScript();
      const onRunAll = () => runViaEditor ? void m.runScript!(true) : host.runScript(true);
      // ...
  }
  ```

### Step 14 — Smoke-test gating: keep legacy TextEditor / ActiveEditor reachable

Legacy `text/TextEditor.tsx`, `ActiveEditor.tsx`, `TextEditorView.tsx`, `TextEditor`'s TextViewModel — **stay untouched**. They're still reachable when:
- The page's main is a `LegacyEditorAdapter` wrapping a non-Monaco content-view editor (Grid / Markdown / etc.). RenderEditor routes to `<TextEditorView>` → `<ActiveEditor>` → `<AsyncEditor>`.
- Encryption fallback: `<ActiveEditor>` forces `<TextEditor>` when `state.encrypted === true`. Even though MonacoEditor handles encryption via `readOnly`, the legacy adapter path keeps `<TextEditor>` for non-Monaco-targeted pages whose content is encrypted.

Removal of these files defers to **US-552 → US-554** (when their consumers — Grid, Preview group — get their own migrations) and **US-559** (final sweep).

## Files Changed

| File | Change | Why |
|------|--------|-----|
| `src/renderer/editors/monaco/MonacoEditor.ts` | **new** | Native v4 MonacoEditor + queue unions + state. |
| `src/renderer/editors/monaco/MonacoBody.tsx` | **new** | Monaco view — queue drain + setup helpers. |
| `src/renderer/editors/monaco/index.ts` | **new** | EditorModule export. |
| `src/renderer/editors/text/TextEditorModel.ts` | modify | Add `getDescriptor`, `setStorage` (stub), static `fromDescriptor`. |
| `src/renderer/editors/text/TextFileActionsModel.ts` | modify | Add `runScriptWith(text, language)`; rewrite `runScript`/`runRelatedScript` to delegate. |
| `src/renderer/editors/base/v4/LegacyEditorAdapter.ts` | modify | Register `CONTENT_HOST_TRAIT` for textFile; implement `switchFrom`; honor extracted host in `dispose`; re-subscribe descriptorChanged on host swap. |
| `src/renderer/editors/base/v4/TextChrome.tsx` | modify | `model.focus()` after 200ms; F5 route to `model.runScript()`; RunButtons branch on `model.runScript`. |
| `src/renderer/editors/base/v4/PageToolbar.tsx` | modify | `onSwitch`: route Monaco-targeted via `page.switchMainEditor`. |
| `src/renderer/editors/register-editors.ts` | modify | Register native `monaco` v4 entry; bare-adapter `loadModule` factories for other content-view entries. |
| `src/renderer/api/pages/PageModel.ts` | modify | `unwrapAdapter` returns MonacoEditor's host. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | modify | `wrapForPage(legacy)` helper; openFile / addEmptyPage / addEditorPage / addDrawPage / requireWellKnownPage / navigatePageTo / requireGroupedText use it. |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | modify | `restorePage` Monaco-native branch. |
| `src/renderer/ui/app/Pages.tsx` | modify | Pass `mainEditorV4` to RenderEditor. |
| `src/renderer/ui/app/RenderEditor.tsx` | modify | Branch on `instanceof LegacyEditorAdapter`; v4-native routes through `editorRegistry.loadModule(editorId).Component`. |
| `src/renderer/scripting/api-wrapper/TextEditorFacade.ts` | rewrite | Wrap MonacoEditor; query methods async. |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | modify | `asText()` returns facade over v4 MonacoEditor; drop `acquireViewModel("monaco")`. |
| `src/renderer/api/types/text-editor.d.ts` | modify | `getSelectedText` / `getCursorPosition` / `insertText` / `replaceSelection` → `Promise`. |
| `assets/editor-types/text-editor.d.ts` | auto-mirror | Watcher-synced copy. |

### Files NOT changed in US-551 (deferred)

- `src/renderer/editors/text/TextEditor.tsx` (TextViewModel + view) — still reachable via `<ActiveEditor>` for legacy adapters and the encryption fallback. Retires in US-552 / US-554 / US-559.
- `src/renderer/editors/text/TextEditorView.tsx` — still wraps legacy adapter content-views. Retires in US-558.
- `src/renderer/editors/text/ActiveEditor.tsx` — dispatcher for legacy adapter. Retires in US-558.
- `src/renderer/editors/text/ScriptPanel.tsx` — host-owned, no rewrites needed (model is still legacy TextFileModel).
- `src/renderer/editors/text/TextFileIOModel.ts`, `TextFileEncryptionModel.ts` — host submodels, unchanged.
- `src/renderer/editors/text/paste-rich-text.ts` — pure helper, imported by MonacoBody.
- `src/renderer/editors/text/index.ts` — exports unchanged.
- `src/renderer/editors/base/EditorModel.ts` (legacy base) — used by all non-migrated editors.
- `src/renderer/editors/base/ContentViewModel.ts`, `ContentViewModelHost.ts`, `useContentViewModel.ts`, `IContentHost.ts` (legacy) — still used by 10+ content-view editors. Retire with US-552 onward.
- `src/renderer/editors/notebook/note-editor/NoteItemEditModel.ts` (per-note Monaco) — untouched; migrates in US-557.
- `src/renderer/api/mcp-handler.ts` — three `acquireViewModelSync("log-view")` sites stay marked for US-553 (LogView migration). MCP `getTextFileHost` reads still work — the legacy TextFileModel is MonacoEditor's host, and `getTextFileHost` resolves it via the v4 surface (`PagesQueryModel.getTextFileHost` needs a tiny update — see concern M11).

## Concerns

### M1 — New folder placement: `editors/monaco/` (new) vs `editors/text/` rename — **RESOLVED 2026-05-21: new folder**

Walkthrough 20 envisioned `text/` → `monaco/` rename. But the rename would force every sibling content-view editor (Grid, MD, Mermaid, SVG, HTML, Notebook, Todo, Link, Log, Rest, Graph, Draw — 13 files) to update imports of `TextFileModel` / `ScriptPanel` / `TextEditorView` / `paste-rich-text`. They aren't migrated yet, so their imports must keep working.

**Options:**

(a) **Create `editors/monaco/` alongside `editors/text/`** — three new files. `text/` keeps its current contents; new MonacoEditor imports cross-folder into `text/TextEditorModel`, `text/paste-rich-text`. **Recommended.** Defers the rename to US-559.

(b) **Rename `text/` → `monaco/` now** — requires touching 13 sibling editor files. Bigger blast radius; nothing prevents per-editor migrations from doing their own renames later.

(c) **Put MonacoEditor inside `text/`** — coexist with TextFileModel. Confusing semantically; `text/` would have two editor classes (legacy TextFileModel and v4 MonacoEditor) plus three rendering paths.

### M2 — `TextFileModel` relocation: defer to US-559 — **RESOLVED 2026-05-21: in-place keep**

Walkthrough 20 said `TextFileModel` relocates to `src/renderer/api/content/TextFileModel.ts`. But every text-bearing content-view editor (Grid, MD, etc.) still imports it from `editors/text/TextEditorModel`. Relocating now touches 10+ files.

**Options:**

(a) **Keep `TextFileModel` at `editors/text/TextEditorModel.ts`** for US-551. Add new methods (`getDescriptor`, `setStorage`, static `fromDescriptor`) in-place. Relocate later — likely US-559 when only Monaco remains as a consumer. **Recommended.**

(b) **Relocate now** — every sibling editor updates its import. Big cross-task change.

### M3 — Cross-camp switch design (v4 Monaco ↔ legacy adapter) — **RESOLVED 2026-05-21: Option (a) — bare-adapter factory + `LegacyEditorAdapter.switchFrom`**

The switch widget (`<SwitchWidget>` in `PageToolbar`) is the user's primary way to swap editor type. Cross-camp transitions need a clear path.

**Options:**

(a) **Bare-adapter factory in v4 registry + `LegacyEditorAdapter.switchFrom` implementation.** Step 4 + Step 5 + Step 6. The bridge `loadModule` for legacy content-views constructs a placeholder `LegacyEditorAdapter(emptyLegacy, targetId)`; `adapter.switchFrom(monacoEditor)` extracts the host (legacy TextFileModel — same object the MonacoEditor wraps) and replaces `this.legacy`. The placeholder is GC'd. Mutates `state.editor = targetId` on the adopted host so the legacy `<ActiveEditor>` renders the right view. **Recommended** — symmetric with Monaco's switchFrom, both directions go through the same `page.switchMainEditor → createEditor → switchFrom → restore` flow.

(b) **Special-case in `PageModel.switchMainEditor`** for v4-native → legacy. Build the LegacyEditorAdapter inline without going through `editorRegistry.createEditor` for legacy targets. Cleaner for the registry (no placeholder), but adds a branch in `PageModel`.

(c) **Route everything through `legacy.changeEditor`** while Monaco is the only v4-native editor. Means switching from MonacoEditor to Grid stays in MonacoEditor (just mutate `host.state.editor`). RenderEditor would have to render Grid INSIDE MonacoEditor's chrome despite MonacoEditor being the model. Unworkable — chrome can't render two body components.

### M4 — `RenderEditor` routing — **RESOLVED 2026-05-21: Option (a) — branch on `instanceof LegacyEditorAdapter`**

How does `RenderEditor` distinguish v4-native (mount MonacoEditor's Component) from legacy-adapter (mount `<TextEditorView>` / standalone-AsyncEditor)?

**Options:**

(a) **Branch on `model instanceof LegacyEditorAdapter`.** Step 8. Pages.tsx passes `mainEditorV4`. RenderEditor checks the adapter type. **Recommended.**

(b) **Add an `isV4Native: boolean` getter on v4 EditorModel.** Same effect; adds a base-class field.

(c) **Use a separate component for v4-native pages.** Pages.tsx selects RenderEditor or RenderV4Editor based on `mainEditorV4 instanceof LegacyEditorAdapter`. More splitting; same logic.

### M5 — Open-file flow: when to construct MonacoEditor — **RESOLVED 2026-05-21: Option (a) — construct at open time**

Today open-file builds a legacy TextFileModel + LegacyEditorAdapter. Post-US-551, the user-visible result on Monaco-targeted opens is the same either way (legacy adapter renders via `<TextEditorView>` → `<ActiveEditor>` → `<TextEditor>` for state.editor === "monaco"; MonacoEditor renders via `<TextChrome>` + `<MonacoBody>`).

**Options:**

(a) **Construct MonacoEditor at open time** (Step 10) when target editor resolves to "monaco". The user lands directly on the native path; the legacy adapter Monaco path is never reached for new pages. **Recommended.** Smaller surface to test — one Monaco mounting path.

(b) **Only construct MonacoEditor on switch/restore.** Open-file produces a legacy adapter; user must switch (or restart and let restore promote) to get MonacoEditor. Two parallel Monaco mounting paths during US-551's lifetime — confusing and harder to debug.

### M6 — Script API: TextEditorFacade rewrite — **RESOLVED 2026-05-21: Option (a) — accept the async breaking change**

The 4 query methods (`getSelectedText`, `getCursorPosition`, `insertText`, `replaceSelection`) become async (await `queue.execute`). Existing scripts must `await` them.

**Options:**

(a) **Accept the breaking change.** Walkthrough 20 / SF6 commits to it. Document in release notes; script authors add `await`. **Recommended.**

(b) **Keep sync facade** by routing the queue through a synchronous probe. Doable but ugly (would require the view to register a hot-handler that returns immediate values, defeating the queue's point during mount race).

(c) **Two facades** — sync TextEditorFacade for legacy callers, async MonacoEditorFacade for queue-backed callers. Splits the script API surface; rejected.

### M7 — `TextFileActionsModel.runScript` signature refactor — **RESOLVED 2026-05-21: Option (a) — add `runScriptWith(text, language)`**

Selection-aware run today reads `this.model.getSelectedText()` which delegates through the legacy `TextViewModel`. With MonacoEditor active, the legacy TextViewModel isn't mounted; chrome materializes selection via the queue and calls a new method.

**Options:**

(a) **Add `runScriptWith(scriptText, language)`** to TextFileActionsModel. MonacoEditor's `runScript(all?)` materializes selection via the queue and calls `host.actions.runScriptWith(text, language)`. Legacy `runScript(all?)` stays as a thin wrapper that reads selection from the legacy `getSelectedText()` (only reachable when no MonacoEditor is active). **Recommended.**

(b) **Make `runScript(all?)` accept an optional `preFetchedSelection?: string`.** Less clear at call sites.

(c) **Move runScript onto MonacoEditor entirely** (drop from host). Walkthrough 20 / MO6 rejected this — Run is host-level conceptually ("run scripts against this file's content with this file's language"). Grid / Notebook running a script makes less sense than running per host file.

### M8 — F5 keystroke routing — **RESOLVED 2026-05-21: Option (a) — chrome intercepts F5 for `MonacoEditor`**

F5 today flows: chrome `onKeyDown` → `host.handleKeyDown` → `TextFileActionsModel.handleKeyDown` → branches on `script.state.open` → `runScript()` or `runRelatedScript()`. Under MonacoEditor, `runScript()` needs selection from the queue (async); `handleKeyDown` is sync.

**Options:**

(a) **Chrome intercepts F5** before `host.handleKeyDown` when MonacoEditor is active. If ScriptPanel is closed → call `void model.runScript()` (async dispatch). If ScriptPanel is open → fall through to host's `runRelatedScript()` (script panel content runs against the model — selection-agnostic, no async needed). **Recommended.** Minimal change to legacy `actions.handleKeyDown` (it still serves Ctrl+S / Ctrl+Shift+S / Ctrl+Shift+F).

(b) **Make `actions.handleKeyDown` async** — sync handlers in React must `e.preventDefault()` synchronously; doable but loses sync prevention.

(c) **Add an editor-back-reference on the host** so `actions.handleKeyDown` can dispatch via `editor.runScript()`. Re-introduces the conflation EPIC-028 removes.

### M9 — Persistence restore — Monaco-native vs legacy-adapter detection — **RESOLVED 2026-05-21: Option (a) — `editorId === "monaco" && d.host !== undefined`**

After US-551, persistence writes BOTH shapes side-by-side: MonacoEditor entries have `editorId: "monaco"` + `host: { kind: "textFile", ... }`; legacy adapter entries have `editorId: "..."` + `host: undefined` + the legacy fields inline in `state`.

**Options:**

(a) **Detect via `editorId === "monaco" && d.host !== undefined`** — go through v4 `editorRegistry.createEditor → applyRestoreData → restore`. Otherwise legacy path. **Recommended.** Pre-US-551 sessions with state.editor === "monaco" but no host descriptor restore as legacy adapter (and re-save as v4-native on next state change).

(b) **Detect via `editorId === "monaco"` alone** — even legacy-shaped Monaco entries route to MonacoEditor. Need to back-fill `host` from the legacy state.editor inline — workable but adds a back-fill branch on the read path. Rejected.

### M10 — Legacy file retention — **RESOLVED 2026-05-21: Option (a) — keep legacy `text/` files; retire in US-552 / US-558 / US-559**

`text/TextEditor.tsx` (TextViewModel + view), `text/ActiveEditor.tsx`, `text/TextEditorView.tsx` are still reachable post-US-551 via legacy adapter content-views (Grid / MD / etc.) and the encryption fallback. Walkthrough 20 listed them for deletion.

**Options:**

(a) **Keep them.** US-552 (Grid) and US-554 (Preview group) each contain ONE file's worth of consumers; their migrations naturally drop those import lines. US-558 deletes `<TextEditorView>`, `<ActiveEditor>`, `<TextEditor>` after all content-views migrate. **Recommended** — US-551 stays focused on Monaco's seam.

(b) **Delete them now** — breaks every legacy content-view editor (Grid / MD / Mermaid / SVG / HTML / Notebook / Todo / Link / Log / Rest / Graph / Draw). Cannot land in a single task without migrating all of them simultaneously. Rejected.

### M11 — `PagesQueryModel.getTextFileHost` update — **RESOLVED 2026-05-21: Option (a) — augment to read `contentHost` for v4-native editors**

`getTextFileHost(pageId)` returns the page's legacy TextFileModel host today, by checking `mainEditorV4 instanceof LegacyEditorAdapter` and unwrapping `.legacy`. After US-551, the page's mainEditorV4 may be `MonacoEditor` (not a `LegacyEditorAdapter`), whose `_host: TextFileModel` lives on the editor itself.

**Options:**

(a) **Augment `getTextFileHost`** — also check `main.contentHost?.type === "textFile"`, return it cast to TextFileModel:
  ```ts
  getTextFileHost(pageId): TextFileModel | null {
      const main = page?.mainEditorV4;
      if (!main) return null;
      if (main instanceof LegacyEditorAdapter) {
          if ((main.legacy as { type?: string }).type === "textFile") return main.legacy as unknown as TextFileModel;
      } else {
          // v4-native — read contentHost.
          const host = main.contentHost;
          if (host && (host as { type?: string }).type === "textFile") return host as unknown as TextFileModel;
      }
      return null;
  }
  ```
  **Recommended.** Lets MCP `get_page_content` / `set_page_content`, compare-mode, grouped-text-host, etc. continue to work transparently when the editor is native Monaco.

(b) **Stay as-is** — `getTextFileHost` returns null for v4-native Monaco pages. Breaks MCP content reads on Monaco pages. Rejected.

## Acceptance criteria

Functional (manual smoke-test list):

1. **Empty page lifecycle** — open empty Monaco page, type some text, press Ctrl+S → "Save As" dialog → save to disk. Reopen the file. Content matches. ✅
2. **Switch Monaco → Grid** — open `.grid.json`, click Grid in switch widget. Grid renders. Switch back to Monaco; Grid edits survive (host stayed intact). ✅
3. **Switch Grid → Monaco** — same as #2 starting from Grid. Monaco renders the JSON text. Edits round-trip. ✅
4. **Switch Monaco → Markdown** — open a `.md` file. Switch widget shows Preview. Switching renders the Markdown preview. Switch back. ✅
5. **Switch Monaco ↔ Notebook** — open a `.note.json` file. Notebook view renders. Switch to Monaco shows the underlying JSON. Switch back to Notebook. ✅
6. **F5 (Ctrl+R run)** — open a `.js` page, type a script, press F5 → runs full content. Select a fragment, press F5 → runs only the selection. Output appears in grouped page. ✅
7. **F5 with ScriptPanel open** — open ScriptPanel, type a script, press F5 → runs ScriptPanel content (`runRelatedScript`). ✅
8. **Encryption** — open an encrypted file, enter password, decrypt. Re-encrypt with current password. Lock and unlock. Save the encrypted file. ✅
9. **Compare mode** — open two text files, group them, enter compare mode. Diff renders. Exit compare. ✅
10. **Page navigation** — click a link to a different file in the same tab. Editor swaps to the new file (with new MonacoEditor instance — id changes). Old page state cleared. ✅
11. **Multi-window page move** — drag a Monaco tab to a new window. New window opens with the Monaco page intact (file, content, script panel state). ✅
12. **App restart (state preservation)** — open a few Monaco pages with unsaved changes. Quit, restart. All pages restore with content and modified flag. ✅
13. **App restart (pre-US-551 session)** — first launch after US-551 with existing `openFiles.txt` from pre-EPIC-028 (v3 format). Pages restore via `restoreV3` → wrap as legacy adapter (state.editor === "monaco"). On first save, the file rewrites as v4 with native MonacoEditor entries. Second launch restores natively. ✅
14. **Script API — sync facade methods unchanged**: `page.asText().revealLine(N)` works (still sync). `page.asText().setHighlightText("foo")` works. ✅
15. **Script API — async facade methods (breaking change)**: `await page.asText().getSelectedText()` returns selection. Old `page.asText().getSelectedText()` (no await) returns a Promise — script breaks loudly with a clear error rather than silently. Documented in release notes. ✅
16. **Script API — page.editor write**: `page.editor = "grid-json"` switches the editor. `page.editor` reads back the current editor id. ✅
17. **MCP `get_page_content` / `set_page_content`** — works against a Monaco page. ✅
18. **MCP `get_pages`** — returns the active editor's id ("monaco") and language/filePath sourced via `getTextFileHost` (M11). ✅
19. **NavPanel button** — visible on Monaco pages with a file path (PT5 / B3 via `getNavigatorTarget`). Clicking opens the navigator panel. ✅

Code health:

20. `npm run lint` — zero new errors on touched files.
21. TypeScript baseline — 18 errors (matches US-549/US-550 baseline). Zero new errors.

## Status

**Ready to implement (all 11 concerns resolved 2026-05-21).**

Final concern outcomes:

| # | Resolution |
|---|------------|
| M1 | (a) — new `src/renderer/editors/monaco/` folder alongside `text/`; defer rename to US-559 |
| M2 | (a) — keep `TextFileModel` at `editors/text/TextEditorModel.ts`; add `getDescriptor`/`setStorage`/`fromDescriptor` in place |
| M3 | (a) — bare-adapter factory in v4 registry + `LegacyEditorAdapter.switchFrom` host adoption |
| M4 | (a) — `RenderEditor` branches on `instanceof LegacyEditorAdapter`; v4-native routes through `editorRegistry.loadModule().Component` |
| M5 | (a) — construct `MonacoEditor` at open time (single Monaco mounting path during US-551) |
| M6 | (a) — accept async breaking change on 4 facade query methods (SF6); document in release notes |
| M7 | (a) — add `runScriptWith(scriptText, language)` to `TextFileActionsModel`; `runScript(all?)` becomes a thin caller |
| M8 | (a) — chrome intercepts F5 when `model.runScript` exists; ScriptPanel-open keeps `host.handleKeyDown` route |
| M9 | (a) — `editorId === "monaco" && d.host !== undefined` → native MonacoEditor restore; otherwise legacy-adapter restore |
| M10 | (a) — keep legacy `text/` files; deletions deferred to US-552 / US-554 / US-558 / US-559 |
| M11 | (a) — augment `getTextFileHost` to read `main.contentHost` for v4-native main editors |
