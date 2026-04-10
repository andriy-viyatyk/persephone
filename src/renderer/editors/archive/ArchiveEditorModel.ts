import React from "react";
import { TComponentState, TOneState } from "../../core/state/state";
import { EditorModel, getDefaultEditorModelState } from "../base";
import type { IEditorState } from "../../../shared/types";
import type { ArchiveTreeProvider } from "../../content/tree-providers/ArchiveTreeProvider";
import { fpBasename } from "../../core/utils/file-path";
import { ArchiveIcon } from "../../theme/icons";
import type { PageModel } from "../../api/pages/PageModel";
import type { NavigationState } from "../../api/pages/PageModel";

export interface ArchiveEditorModelState extends IEditorState {
    type: "archiveFile";
    /** Archive source URL (path to the archive file). */
    archiveUrl: string;
}

export function getDefaultArchiveEditorModelState(): ArchiveEditorModelState {
    return {
        ...getDefaultEditorModelState(),
        type: "archiveFile",
        archiveUrl: "",
    } as ArchiveEditorModelState;
}

export class ArchiveEditorModel extends EditorModel<ArchiveEditorModelState> {
    /** Tree provider for browsing archive contents. Owned by this model. */
    treeProvider: ArchiveTreeProvider | null = null;

    /** Selection state — highlights current entry in the archive tree. */
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });

    /** Reveal request — reactive counter. When bumped, the component should call revealItem(selectedHref). */
    readonly revealVersion = new TOneState({ version: 0 });

    constructor(state?: TComponentState<ArchiveEditorModelState>) {
        super(state ?? new TComponentState(getDefaultArchiveEditorModelState()));
        this.noLanguage = true;
        this.getIcon = () => React.createElement(ArchiveIcon, { width: 16, height: 16 });
    }

    /** Initialize from archive path. Creates ArchiveTreeProvider and sets title. */
    async initFromArchive(archiveUrl: string): Promise<void> {
        const { ArchiveTreeProvider } = await import(
            "../../content/tree-providers/ArchiveTreeProvider"
        );
        this.treeProvider = new ArchiveTreeProvider(archiveUrl);
        this.state.update((s) => {
            s.title = fpBasename(archiveUrl);
            s.archiveUrl = archiveUrl;
        });
    }

    async restore(): Promise<void> {
        await super.restore();
        // Recreate ArchiveTreeProvider from persisted archiveUrl
        const archiveUrl = this.state.get().archiveUrl;
        if (archiveUrl && !this.treeProvider) {
            const { ArchiveTreeProvider } = await import(
                "../../content/tree-providers/ArchiveTreeProvider"
            );
            this.treeProvider = new ArchiveTreeProvider(archiveUrl);
        }
        // Register secondary editor if page is already available (direct open path).
        // For navigation path, page isn't set yet — setPage() handles registration.
        if (this.treeProvider && this.page) {
            this.secondaryEditor = ["archive-tree"];
        }
    }

    /** Register "archive-tree" secondary panel when the page context becomes available. */
    setPage(page: PageModel | null): void {
        super.setPage(page);
        if (page && this.treeProvider && !this.secondaryEditor?.length) {
            this.secondaryEditor = ["archive-tree"];
        }
    }

    /**
     * Navigation survival: keep this model as secondary editor if the new page
     * was opened from this archive (sourceLink.metadata.sourceId matches).
     */
    beforeNavigateAway(newModel: EditorModel): void {
        if (this._isOpenedFromThisArchive(newModel)) return;
        this.secondaryEditor = undefined;
    }

    /**
     * Called when the page's main editor changes during navigation.
     * If the new main editor was NOT opened from this archive, remove self from sidebar.
     */
    onMainEditorChanged(newMainEditor: EditorModel | null): void {
        if (!newMainEditor || newMainEditor === this) return;
        if (this._isOpenedFromThisArchive(newMainEditor)) {
            const url = newMainEditor.state.get().sourceLink?.url ?? null;
            this.selectionState.update((s) => { s.selectedHref = url; });
            if (url && this.page?.activePanel === "archive-tree") {
                this.revealVersion.update((s) => { s.version++; });
            }
            setTimeout(() => this.page?.expandPanel("archive-tree"), 0);
        } else {
            this.secondaryEditor = undefined;
        }
    }

    /** React to panel expansion — reveal current entry when "archive-tree" panel becomes active. */
    onPanelExpanded(panelId: string): void {
        if (panelId === "archive-tree") {
            const href = this.selectionState.get().selectedHref;
            if (href) {
                setTimeout(() => this.revealVersion.update((s) => { s.version++; }), 0);
            }
        }
    }

    /** Check if a model was opened from this archive via sourceLink. */
    private _isOpenedFromThisArchive(model: EditorModel): boolean {
        const sl = model.state.get().sourceLink;
        // Support both new format (sourceId top-level) and legacy persisted format (in metadata)
        return (sl?.sourceId ?? (sl as any)?.metadata?.sourceId) === this.id; // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    async dispose(): Promise<void> {
        this.treeProvider = null;
        await super.dispose();
    }

    applyRestoreData(data: Partial<ArchiveEditorModelState>): void {
        super.applyRestoreData(data as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.archiveUrl) {
            this.state.update((s) => { s.archiveUrl = data.archiveUrl!; });
        }
    }

    getRestoreData(): Partial<ArchiveEditorModelState> {
        return {
            ...super.getRestoreData(),
            archiveUrl: this.state.get().archiveUrl,
        };
    }
}
