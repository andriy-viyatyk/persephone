import { EditorId } from "../../../shared/editor-ids";
import { TComponentState } from "../../core/state/state";
import { settings } from "../../api/settings";
import type { EditorStateBase, RestoreData } from "../base/EditorModel";
import { TextHostEditorModel } from "../base/TextHostEditorModel";
import type { TextFileModel } from "../content-host/TextFileModel";
import { FRESH_EMPTY_TRAIT, TEXT_NAVIGATION_TRAIT, TEXT_SELECTION_TRAIT } from "../base/editor-traits";

export type MonacoQueueEvent =
    | { type: "revealLine"; line: number }
    | { type: "highlightText"; text: string | undefined }
    | { type: "focus" }
    | { type: "openFind" }
    | { type: "openReplace" };

export type MonacoQueueRequest =
    | { type: "getSelectedText" }
    | { type: "getCursorPosition" }
    | { type: "insertText"; text: string }
    | { type: "replaceSelection"; text: string };

export interface MonacoEditorState extends EditorStateBase {
    /** Selection-presence flag — written by `<MonacoBody>`'s selection
     *  listener, read by `<TextChrome>`'s Run-all visibility gate. Non-
     *  persisted (defaults to false on restore). */
    hasSelection: boolean;
    wordWrap: boolean;
    /** Per-page TypeScript error highlighting for project files. */
    diagnostics: boolean;
}

interface MonacoViewSettings {
    wordWrap?: boolean;
    diagnostics?: boolean;
}

export const defaultMonacoEditorState: MonacoEditorState = {
    id: "",
    title: "",
    modified: false,
    secondaryView: undefined,
    hasSelection: false,
    wordWrap: false,
    diagnostics: false,
};

export class MonacoEditor extends TextHostEditorModel<
    MonacoEditorState,
    MonacoQueueEvent,
    MonacoQueueRequest
> {
    readonly editorId = EditorId.monaco;
    protected readonly displayName = "Monaco";

    constructor(state: TComponentState<MonacoEditorState>) {
        super(state);
        this.traits.add(FRESH_EMPTY_TRAIT, { isFreshEmpty: () => this.isFreshEmpty() });
        this.traits.add(TEXT_SELECTION_TRAIT, {
            hasSelection: () => this.state.get().hasSelection,
            getSelectedText: () => this.getSelectedText(),
        });
        this.traits.add(TEXT_NAVIGATION_TRAIT, {
            revealLine: (line) => this.revealLine(line),
            setHighlightText: (text) => this.setHighlightText(text),
            focus: () => this.focus(),
        });
    }

    private isFreshEmpty(): boolean {
        const h = this._host;
        if (!h) return false;
        const hs = h.state.get();
        return (
            hs.content === "" &&
            hs.filePath === undefined &&
            !hs.modified &&
            (this.state.get().title === "" || this.state.get().title === "untitled")
        );
    }

    get wordWrap(): boolean {
        return this.state.get().wordWrap;
    }

    get diagnostics(): boolean {
        return this.state.get().diagnostics;
    }

    adoptHost(host: TextFileModel): void {
        super.adoptHost(host);

        if (host.getEditorState<MonacoViewSettings>(this.editorId) === undefined) {
            const wordWrap = settings.get("editor.word-wrap");
            this.state.update((state) => {
                state.wordWrap = wordWrap;
            });
            host.setEditorState<MonacoViewSettings>(this.editorId, { wordWrap, diagnostics: false });
        }

        this.mirrorHostSettings<MonacoViewSettings>(
            (saved) => {
                if (saved.wordWrap !== undefined) {
                    this.state.update((state) => {
                        state.wordWrap = saved.wordWrap;
                    });
                }
                if (saved.diagnostics !== undefined) {
                    this.state.update((state) => {
                        state.diagnostics = saved.diagnostics;
                    });
                }
            },
            (state) => ({ wordWrap: state.wordWrap, diagnostics: state.diagnostics }),
            (state) => ({ wordWrap: state.wordWrap, diagnostics: state.diagnostics }),
        );
    }

    toggleWordWrap = (): void => {
        this.state.update((state) => {
            state.wordWrap = !state.wordWrap;
        });
    };

    toggleDiagnostics = (): void => {
        this.state.update((state) => {
            state.diagnostics = !state.diagnostics;
        });
    };

    focus(): void {
        this.queue.send({ type: "focus" });
    }

    // ── Typed queue wrappers (script API and chrome consumers) ─────────

    revealLine(line: number): void {
        this.queue.send({ type: "revealLine", line });
    }

    setHighlightText(text: string | undefined): void {
        this.queue.send({ type: "highlightText", text });
    }

    openFind(): void {
        this.queue.send({ type: "openFind" });
    }

    openReplace(): void {
        this.queue.send({ type: "openReplace" });
    }

    async getSelectedText(): Promise<string> {
        return (await this.queue.execute({ type: "getSelectedText" })) as string;
    }

    async getCursorPosition(): Promise<{ lineNumber: number; column: number }> {
        return (await this.queue.execute({ type: "getCursorPosition" })) as {
            lineNumber: number;
            column: number;
        };
    }

    async insertText(text: string): Promise<void> {
        await this.queue.execute({ type: "insertText", text });
    }

    async replaceSelection(text: string): Promise<void> {
        await this.queue.execute({ type: "replaceSelection", text });
    }

    // ── Persistence ─────────────────────────────────────────────────────

    applyRestoreData(data: RestoreData<MonacoEditorState>): void {
        super.applyRestoreData(data);
        if (data.revealLine !== undefined) {
            this.queue.send({ type: "revealLine", line: data.revealLine });
        }
        if (data.highlightText !== undefined) {
            this.queue.send({ type: "highlightText", text: data.highlightText });
        }
    }
}
