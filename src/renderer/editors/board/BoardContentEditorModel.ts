import type { TComponentState } from "../../core/state/state";
import { EditorModel, type EditorRestoreOptions } from "../base/EditorModel";
import type { EditorDescriptor } from "../../../shared/persistence";
import { editorRegistry } from "../base/editorRegistry";
import { fpBasename } from "../../core/utils/file-path";
import { ui } from "../../api/ui";
import { TextFileModel, newTextFileModel } from "../text/TextEditorModel";
import { BoardEditorModel, type BoardEditorState } from "./BoardEditorModel";
import { boardEditorId } from "../../api/boards/custom-editor-registry";
import { errMessage } from "../../../shared/utils";
import { ContentHostSlot } from "../base/content-host-slot";

interface BoardContentListener {
    readonly handler: (content: string) => void;
    unsubscribe: (() => void) | undefined;
}

/**
 * Content-host board. A board that edits a file through Persephone's content host Ã¢â‚¬â€
 * the same `TextFileModel` (`IContentHost`) that backs Monaco / Grid. Persephone owns
 * the pipe, encoding, encryption, auto-save cache, and dirty state; the board works with
 * the content over the `persephone.host.*` bridge.
 */
export class BoardContentEditorModel extends BoardEditorModel {
    override readonly deferRestoreOnOpen = true;
    /** A real editor whose dirty state Persephone tracks (base board is `true`). */
    override skipSave = false;

    private readonly contentHostSlot: ContentHostSlot<BoardEditorState>;
    private readonly boardContentListeners = new Set<BoardContentListener>();

    constructor(state: TComponentState<BoardEditorState>) {
        super(state);
        this.contentHostSlot = new ContentHostSlot(this, {
            displayName: () => "Board content",
            stampEditorId: { fixed: "board-view" },
            createFallbackHost: () => newTextFileModel(this.currentFilePath() ?? ""),
            resolveTitle: ({ hostTitle, filePath, currentTitle }) =>
                hostTitle || (filePath ? fpBasename(filePath) : undefined) || currentTitle,
            onHostStateChanged: (host) => {
                const { filePath, title } = host.state.get();
                const nextTitle = title || (filePath ? fpBasename(filePath) : undefined) || this.state.get().title;
                this.state.update((state) => {
                    if (state.title !== nextTitle) state.title = nextTitle;
                    if (!host.io.providerError && state.contentHostError) state.contentHostError = undefined;
                });
            },
        });
    }

    /** A content-host board is always a custom file editor, while persistence remains board-view. */
    override get contentHost(): TextFileModel | null {
        return this.contentHostSlot.host;
    }

    /**
     * A content-host board keeps the virtual `board-editor:<root>` id so switching back to a
     * built-in editor recognizes the board boundary. Host persistence is stamped `board-view`.
     */
    override get editorId(): string {
        const root = this.state.get().boardRoot;
        return root ? boardEditorId(root) : "board-view";
    }

    override get editorKind() {
        return "content-host" as const;
    }

    /** Keep the switch list aligned with built-in editors accepting the live host. */
    override findCompatibleEditors(): string[] {
        const root = this.state.get().boardRoot;
        if (!root) return [];
        const host = this.contentHostSlot.host;
        const builtins = host
            ? editorRegistry.findEditorsAccepting(host)
            : [editorRegistry.resolveId(this.currentFilePath() ?? this.title) ?? "monaco"];
        return [...builtins, boardEditorId(root)];
    }

    override switchFrom(oldEditor: EditorModel): void {
        this.contentHostSlot.transferFrom(oldEditor);
    }

    /** Public adoption entry point used by construction, transfer and restore. */
    adoptHost(host: TextFileModel): void {
        this.contentHostSlot.adopt(host);
        for (const listener of this.boardContentListeners) {
            listener.unsubscribe = this.contentHostSlot.subscribeContent(listener.handler);
        }
    }

    override setPage(page: Parameters<EditorModel["setPage"]>[0]): void {
        super.setPage(page);
        this.contentHostSlot.setPage(page);
    }

    override async restore(options?: EditorRestoreOptions): Promise<void> {
        await super.restore();
        try {
            await this.contentHostSlot.restore(options);
            this.state.update((state) => {
                state.contentHostError = this.contentHostSlot.host?.io.providerError;
            });
        } catch (err) {
            const message = errMessage(err, "Failed to restore board content.");
            ui.notify(message, "error");
            this.state.update((state) => { state.contentHostError = message; });
        }
        this.contentHostSlot.stash(undefined);
    }

    override getRestoreData(): EditorDescriptor {
        const data = super.getRestoreData();
        data.host = this.contentHostSlot.descriptor();
        return data;
    }

    override applyRestoreData(
        data: Parameters<EditorModel<BoardEditorState>["applyRestoreData"]>[0],
    ): void {
        super.applyRestoreData(data);
        if (data.host) this.contentHostSlot.stash(data.host);
    }

    override get modified(): boolean {
        return this.contentHostSlot.modified;
    }

    override async saveState(): Promise<void> {
        await this.contentHostSlot.saveState();
    }

    override async confirmRelease(closing?: boolean): Promise<boolean> {
        return this.contentHostSlot.confirmRelease(closing);
    }

    override applyBoardContent(content: string): void {
        this.contentHostSlot.write(content, true);
    }

    override saveBoardContent(): void {
        void this.contentHostSlot.host?.saveFile();
    }

    override subscribeBoardContent(handler: (content: string) => void): (() => void) | undefined {
        const listener: BoardContentListener = {
            handler,
            unsubscribe: this.contentHostSlot.subscribeContent(handler),
        };
        this.boardContentListeners.add(listener);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            this.boardContentListeners.delete(listener);
            listener.unsubscribe?.();
            listener.unsubscribe = undefined;
        };
    }

    override setBusy(_busy: boolean): void {
        console.warn(
            "[BoardContentEditorModel] setBoardBusy is not supported for content-host boards — ignoring.",
        );
    }

    override keepAliveOnNavigation(): boolean {
        return false;
    }

    override survivesNavigation(): boolean {
        return false;
    }

    override async dispose(): Promise<void> {
        await this.contentHostSlot.dispose();
        await super.dispose();
    }
}
