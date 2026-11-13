import type { HostDescriptor } from "../../../shared/persistence";
import type { IPageHost } from "../../api/pages/IPageHost";
import type { IState } from "../../core/state/state";
import { createEchoGuard } from "../../core/utils/echo-guard";
import { fpBasename } from "../../core/utils/file-path";
import { TraitSet } from "../../core/traits/traits";
import { Subscription } from "../../core/state/events";
import { CONTENT_HOST_TRAIT, type IContentHostTrait } from "./editor-traits";
import type { EditorModelInstance as EditorModel, EditorRestoreOptions, EditorStateBase } from "./EditorModel";
import { TextFileModel } from "../content-host/TextFileModel";

export interface ContentHostSlotOwner<T extends EditorStateBase = EditorStateBase> {
    readonly editorId: string;
    readonly id: string;
    readonly traits: TraitSet;
    readonly state: IState<T>;
    readonly descriptorChanged: Subscription<void>;
    page: IPageHost | null;
    /** Virtual owner entry point; preserves subclass domain subscriptions. */
    adoptHost(host: TextFileModel): void;
}

export interface ContentHostTitleContext<T extends EditorStateBase> {
    readonly owner: ContentHostSlotOwner<T>;
    readonly host: TextFileModel;
    readonly currentTitle: string;
    readonly filePath: string | undefined;
    readonly hostTitle: string | undefined;
}

export interface ContentHostSlotOptions<T extends EditorStateBase = EditorStateBase> {
    readonly displayName: () => string;
    readonly stampEditorId?: "owner" | { readonly fixed: string };
    readonly untitledName?: () => string;
    readonly createFallbackHost?: (owner: ContentHostSlotOwner<T>) => TextFileModel;
    readonly resolveTitle?: (context: ContentHostTitleContext<T>) => string | undefined;
    readonly onAttached?: (host: TextFileModel) => void;
    readonly onExtracted?: () => void;
    readonly onHostStateChanged?: (host: TextFileModel) => void;
}

export interface ContentHostTransferOptions {
    readonly tolerant?: boolean;
}

/** Owns a single editor's content host and its host-lifetime subscriptions. */
export class ContentHostSlot<T extends EditorStateBase = EditorStateBase> {
    private _host: TextFileModel | null = null;
    private _pendingDescriptor: HostDescriptor | undefined;
    private hostUnsubs: Array<() => void> = [];
    private readonly echoGuard = createEchoGuard<string>();
    private readonly contentHandlers = new Set<{ readonly handler: (content: string) => void }>();
    private contentFanout: (() => void) | undefined;

    constructor(
        private readonly owner: ContentHostSlotOwner<T>,
        private readonly options: ContentHostSlotOptions<T>,
    ) {
        const trait: IContentHostTrait = {
            extractContentHost: () => this.extract(),
        };
        owner.traits.add(CONTENT_HOST_TRAIT, trait);
    }

    get host(): TextFileModel | null {
        return this._host;
    }

    get pendingDescriptor(): HostDescriptor | undefined {
        return this._pendingDescriptor;
    }

    get modified(): boolean {
        return this._host?.modified ?? false;
    }

    descriptor(): HostDescriptor | undefined {
        return this._host?.getDescriptor();
    }

    stash(descriptor: HostDescriptor | undefined): void {
        this._pendingDescriptor = descriptor;
    }

    adopt(host: TextFileModel): void {
        this._host = host;
        this.teardownSubscriptions();
        this.registerSubscription(host.state.subscribe(() => {
            this.owner.descriptorChanged.send(undefined);
            this.options.onHostStateChanged?.(host);
        }));

        const { filePath, title: hostTitle } = host.state.get();
        const currentTitle = this.owner.state.get().title;
        const title = this.options.resolveTitle?.({
            owner: this.owner,
            host,
            currentTitle,
            filePath,
            hostTitle,
        }) ?? (this.options.resolveTitle
            ? undefined
            : hostTitle || (filePath ? fpBasename(filePath) : currentTitle || this.options.untitledName?.() || "untitled"));
        this.owner.state.update((state) => {
            if (title !== undefined) state.title = title;
            const hostId = host.state.get().id;
            if (hostId) state.id = hostId;
        });

        const stamp = this.options.stampEditorId === "owner"
            ? this.owner.editorId
            : this.options.stampEditorId?.fixed;
        if (stamp !== undefined) {
            host.state.update((state) => {
                if (state.editor !== stamp) state.editor = stamp as typeof state.editor;
            });
        }
        if (this.owner.page) host.setPage(this.owner.page);
    }

    extract(): TextFileModel {
        const host = this._host;
        if (!host) {
            throw new Error(`Host already extracted from ${this.options.displayName()} editor`);
        }
        this.teardownSubscriptions();
        this.options.onExtracted?.();
        this._host = null;
        return host;
    }

    transferFrom(oldEditor: EditorModel, options?: ContentHostTransferOptions): TextFileModel | null {
        const trait = oldEditor.traits.get(CONTENT_HOST_TRAIT);
        if (!trait) {
            if (options?.tolerant) return null;
            throw new Error(
                `${this.options.displayName()} editor switchFrom: ${oldEditor.editorId} has no CONTENT_HOST_TRAIT`,
            );
        }
        const host = trait.extractContentHost();
        this.owner.state.update((state) => {
            state.id = oldEditor.id;
        });
        this.owner.adoptHost(host);
        this.options.onAttached?.(host);
        return host;
    }

    async restore(options?: EditorRestoreOptions): Promise<TextFileModel | null> {
        let host = this._host;
        if (!host) {
            host = this._pendingDescriptor
                ? await TextFileModel.fromDescriptor(this._pendingDescriptor)
                : this.options.createFallbackHost?.(this.owner) ?? null;
            if (!host) return null;
            // Hold the host while it loads: a session save during the load must still persist its
            // descriptor, and a failed or aborted load leaves it owned here so dispose releases it.
            this._host = host;
        }
        if (!host.state.get().restored) await host.restore(options);
        this.owner.adoptHost(host);
        this.options.onAttached?.(host);
        this.stash(undefined);
        return host;
    }

    bootstrap(): void {
        if (this._host) this.options.onAttached?.(this._host);
    }

    registerSubscription(unsubscribe: () => void): void {
        this.hostUnsubs.push(unsubscribe);
    }

    teardownSubscriptions(): void {
        for (const unsubscribe of this.hostUnsubs) unsubscribe();
        this.hostUnsubs = [];
    }

    write(content: string, byUser?: boolean): void {
        if (!this._host) return;
        this.echoGuard.arm(content);
        this._host.changeContent(content, byUser);
    }

    subscribeContent(handler: (content: string) => void): (() => void) | undefined {
        const host = this._host;
        if (!host) return undefined;
        if (!this.contentFanout) {
            // One host subscription per slot: the echo guard is consumed once per content change and the
            // result fans out to every handler. A guard consumed per handler would let the second handler
            // receive the owner's own write as an external change.
            this.contentFanout = host.state.subscribe(
                (content) => {
                    const nextContent = (content as string) ?? "";
                    if (this.echoGuard.consume(nextContent)) return;
                    for (const entry of [...this.contentHandlers]) entry.handler(nextContent);
                },
                (state) => state.content,
            );
        }
        const entry = { handler };
        this.contentHandlers.add(entry);
        let active = true;
        const unsubscribe = () => {
            if (!active) return;
            active = false;
            this.contentHandlers.delete(entry);
            if (this.contentHandlers.size === 0) {
                this.contentFanout?.();
                this.contentFanout = undefined;
            }
        };
        this.registerSubscription(unsubscribe);
        return unsubscribe;
    }

    mirrorSettings<S>(
        apply: (saved: S) => void,
        snapshot: (state: T) => S,
        selector?: (state: T) => unknown,
        shouldMirror?: () => boolean,
    ): void {
        const host = this._host;
        if (!host) return;
        const saved = host.getEditorState<S>(this.owner.editorId);
        if (saved !== undefined) apply(saved);
        const mirror = () => {
            if (shouldMirror && !shouldMirror()) return;
            this._host?.setEditorState<S>(this.owner.editorId, snapshot(this.owner.state.get()));
        };
        this.registerSubscription(selector
            ? this.owner.state.subscribe(mirror, selector)
            : this.owner.state.subscribe(mirror));
    }

    setPage(page: IPageHost | null): void {
        this._host?.setPage(page);
    }

    async confirmRelease(closing?: boolean): Promise<boolean> {
        return this._host ? this._host.confirmRelease(closing) : true;
    }

    async saveState(): Promise<void> {
        await this._host?.io.saveState();
    }

    async dispose(): Promise<void> {
        this.teardownSubscriptions();
        if (this._host) {
            await this._host.dispose();
            this._host = null;
        }
    }
}
