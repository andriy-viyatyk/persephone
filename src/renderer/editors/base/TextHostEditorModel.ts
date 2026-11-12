import { EditorModel, type EditorRestoreOptions, type EditorStateBase, type RestoreData } from "./EditorModel";
import type { ComponentQueueEvent } from "../../core/state/ComponentQueue";
import type { EditorDescriptor } from "../../../shared/persistence";
import type { IContentPipe } from "../../api/types/io.pipe";
import type { IPageHost } from "../../api/pages/IPageHost";
import type { IState } from "../../core/state/state";
import { TextFileModel, newTextFileModel } from "../text/TextEditorModel";
import { editorRegistry } from "./editorRegistry";
import { fpBasename } from "../../core/utils/file-path";
import { ui } from "../../api/ui";
import { errMessage } from "../../../shared/utils";
import { ContentHostSlot } from "./content-host-slot";

/**
 * Base class for editors that wrap a `TextFileModel` content host.
 *
 * Keeps the established subclass API while `ContentHostSlot` owns host
 * lifecycle, transfer, subscriptions and content synchronization.
 */
export abstract class TextHostEditorModel<
    T extends EditorStateBase = EditorStateBase,
    R = unknown,
    E extends ComponentQueueEvent = ComponentQueueEvent,
> extends EditorModel<T, R, E> {
    override readonly deferRestoreOnOpen = true;
    /** Human-readable editor name for error/notify strings. */
    protected abstract readonly displayName: string;

    protected readonly contentHostSlot: ContentHostSlot<T>;

    protected get _host(): TextFileModel | null {
        return this.contentHostSlot.host;
    }

    constructor(
        modelState: IState<T> | (new (defaultState: T) => IState<T>),
        defaultState?: T,
    ) {
        super(modelState, defaultState);
        this.contentHostSlot = new ContentHostSlot(this, {
            displayName: () => this.displayName,
            stampEditorId: "owner",
            untitledName: () => this.untitledName(),
            createFallbackHost: () => newTextFileModel(""),
            resolveTitle: ({ hostTitle, filePath, currentTitle }) =>
                hostTitle || (filePath ? fpBasename(filePath) : undefined)
                    || currentTitle || this.untitledName(),
            onAttached: (host) => this.onHostAttached(host),
            onExtracted: () => this.onHostExtracted(),
        });
    }

    /** Track a host-lifetime unsubscribe, torn down with the slot's set. */
    protected registerHostSubscription(unsubscribe: () => void): void {
        this.contentHostSlot.registerSubscription(unsubscribe);
    }

    protected teardownHostSubscriptions(): void {
        this.contentHostSlot.teardownSubscriptions();
    }

    /** Called after subscriptions are torn down and before an extracted host is released. */
    protected onHostExtracted(): void {
        // Override in subclasses.
    }

    /** Called after switch, successful restore, or open-file bootstrap. */
    protected onHostAttached(_host: TextFileModel): void {
        // Override in subclasses.
    }

    /** Title fallback when neither host nor editor state carries one. */
    protected untitledName(): string {
        return "untitled";
    }

    get contentHost(): TextFileModel | null {
        return this.contentHostSlot.host;
    }

    /** Host accessor for body, toolbar and facade consumption. */
    get host(): TextFileModel | null {
        return this.contentHostSlot.host;
    }

    findCompatibleEditors(): string[] {
        const host = this.contentHostSlot.host;
        return host ? editorRegistry.findEditorsAccepting(host) : [];
    }

    getNavigatorTarget(): { pipe?: IContentPipe | null; filePath?: string | null } | null {
        const host = this.contentHostSlot.host;
        if (!host) return null;
        const { filePath } = host.state.get();
        const pipe = host.pipe;
        if (!pipe && !filePath) return {};
        return { pipe, filePath };
    }

    /** Identity-only editor descriptor; the host descriptor persists beside editor state. */
    getRestoreData(): EditorDescriptor {
        const state = this.state.get();
        return {
            editorId: this.editorId,
            id: state.id,
            state: {
                title: state.title,
                modified: state.modified,
                secondaryView: state.secondaryView,
            } as Record<string, unknown>,
            host: this.contentHostSlot.descriptor(),
        };
    }

    applyRestoreData(data: RestoreData<T>): void {
        this.state.update((state) => {
            if (data.title !== undefined) state.title = data.title;
            if (data.modified !== undefined) state.modified = data.modified;
            if (data.secondaryView !== undefined) state.secondaryView = data.secondaryView;
        });
        if (data.host) this.contentHostSlot.stash(data.host);
    }

    switchFrom(oldEditor: EditorModel): void {
        this.contentHostSlot.transferFrom(oldEditor);
    }

    async restore(options?: EditorRestoreOptions): Promise<void> {
        // A persisted-host failure must reach restorePage(), which keeps its descriptor as a recovery placeholder.
        const fromPersistedHost = this.contentHostSlot.pendingDescriptor !== undefined;
        try {
            await this.contentHostSlot.restore(options);
        } catch (err) {
            // Cancelled while loading: the page is closing, so there is nothing to report.
            if (options?.signal?.aborted) return;
            if (fromPersistedHost) throw err;
            ui.notify(
                errMessage(err, `Failed to restore ${this.displayName} editor.`),
                "error",
            );
            this.adoptHost(newTextFileModel(""));
            this.contentHostSlot.stash(undefined);
        }
    }

    /** Runs the initial-load hook against a host adopted by the open-file path. */
    bootstrapFromHost(): void {
        this.contentHostSlot.bootstrap();
    }

    /** Public adoption entry point; subclasses call super before attaching domain subscriptions. */
    adoptHost(host: TextFileModel): void {
        this.contentHostSlot.adopt(host);
    }

    setPage(page: IPageHost | null): void {
        super.setPage(page);
        this.contentHostSlot.setPage(page);
    }

    /** Write through the bounded shared echo guard. */
    protected writeToHost(content: string, byUser?: boolean): void {
        this.contentHostSlot.write(content, byUser);
    }

    /** Subscribe to host content changes, skipping this editor's own writes. */
    protected subscribeHostContent(handler: (content: string) => void): void {
        this.contentHostSlot.subscribeContent(handler);
    }

    /** Restore and mirror this editor's per-host settings slot. */
    protected mirrorHostSettings<S>(
        apply: (saved: S) => void,
        snapshot: (state: T) => S,
        selector?: (state: T) => unknown,
        shouldMirror?: () => boolean,
    ): void {
        this.contentHostSlot.mirrorSettings(apply, snapshot, selector, shouldMirror);
    }

    async confirmRelease(closing?: boolean): Promise<boolean> {
        return this.contentHostSlot.confirmRelease(closing);
    }

    async saveState(): Promise<void> {
        await this.contentHostSlot.saveState();
    }

    /** Dispose the host before the editor superclass tears down its own resources. */
    async dispose(): Promise<void> {
        await this.contentHostSlot.dispose();
        await super.dispose();
    }
}
