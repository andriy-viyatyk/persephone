import React from "react";
import { TComponentState, TOneState } from "../../core/state/state";
import { EditorModel, getDefaultEditorModelState } from "../base";
import type { IEditorState } from "../../../shared/types";
import type { ZipTreeProvider } from "../../content/tree-providers/ZipTreeProvider";
import { fpBasename } from "../../core/utils/file-path";
import { ArchiveIcon } from "../../theme/icons";
import type { PageModel } from "../../api/pages/PageModel";
import type { NavigationState } from "../../api/pages/PageModel";

export interface ZipEditorModelState extends IEditorState {
    type: "zipFile";
    /** Archive source URL (path to the .zip file). */
    archiveUrl: string;
}

export function getDefaultZipEditorModelState(): ZipEditorModelState {
    return {
        ...getDefaultEditorModelState(),
        type: "zipFile",
        archiveUrl: "",
    } as ZipEditorModelState;
}

export class ZipEditorModel extends EditorModel<ZipEditorModelState> {
    /** Tree provider for browsing archive contents. Owned by this model. */
    treeProvider: ZipTreeProvider | null = null;

    /** Selection state — highlights current entry in the archive tree. */
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });

    /** Reveal request — reactive counter. When bumped, the component should call revealItem(selectedHref). */
    readonly revealVersion = new TOneState({ version: 0 });

    constructor(state?: TComponentState<ZipEditorModelState>) {
        super(state ?? new TComponentState(getDefaultZipEditorModelState()));
        this.noLanguage = true;
        this.getIcon = () => React.createElement(ArchiveIcon, { width: 16, height: 16 });
    }

    /** Initialize from archive path. Creates ZipTreeProvider and sets title. */
    async initFromArchive(archiveUrl: string): Promise<void> {
        const { ZipTreeProvider } = await import(
            "../../content/tree-providers/ZipTreeProvider"
        );
        this.treeProvider = new ZipTreeProvider(archiveUrl);
        this.state.update((s) => {
            s.title = fpBasename(archiveUrl);
            s.archiveUrl = archiveUrl;
            // Don't set secondaryEditor here — it must go through the setter
            // (which calls addSecondaryModel). The setter is called in restore()
            // or by _openZipArchive after NavigationData is attached.
        });
    }

    async restore(): Promise<void> {
        await super.restore();
        // Recreate ZipTreeProvider from persisted archiveUrl
        const archiveUrl = this.state.get().archiveUrl;
        if (archiveUrl && !this.treeProvider) {
            const { ZipTreeProvider } = await import(
                "../../content/tree-providers/ZipTreeProvider"
            );
            this.treeProvider = new ZipTreeProvider(archiveUrl);
        }
        // Register secondary editor if page is already available (direct open path).
        // For navigation path, page isn't set yet — setPage() handles registration.
        if (this.treeProvider && this.page) {
            this.secondaryEditor = ["zip-tree"];
        }
    }

    /** Register "zip-tree" secondary panel when the page context becomes available. */
    setPage(page: PageModel | null): void {
        super.setPage(page);
        if (page && this.treeProvider && !this.secondaryEditor?.length) {
            this.secondaryEditor = ["zip-tree"];
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
            if (url && this.page?.activePanel === "zip-tree") {
                this.revealVersion.update((s) => { s.version++; });
            }
            setTimeout(() => this.page?.expandPanel("zip-tree"), 0);
        } else {
            this.secondaryEditor = undefined;
        }
    }

    /** React to panel expansion — reveal current entry when "zip-tree" panel becomes active. */
    onPanelExpanded(panelId: string): void {
        if (panelId === "zip-tree") {
            const href = this.selectionState.get().selectedHref;
            if (href) {
                setTimeout(() => this.revealVersion.update((s) => { s.version++; }), 0);
            }
        }
    }

    /** Check if a model was opened from this archive via sourceLink metadata. */
    private _isOpenedFromThisArchive(model: EditorModel): boolean {
        return model.state.get().sourceLink?.metadata?.sourceId === this.id;
    }

    async dispose(): Promise<void> {
        this.treeProvider = null;
        await super.dispose();
    }

    applyRestoreData(data: Partial<ZipEditorModelState>): void {
        super.applyRestoreData(data as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.archiveUrl) {
            this.state.update((s) => { s.archiveUrl = data.archiveUrl!; });
        }
    }

    getRestoreData(): Partial<ZipEditorModelState> {
        return {
            ...super.getRestoreData(),
            archiveUrl: this.state.get().archiveUrl,
        };
    }
}
