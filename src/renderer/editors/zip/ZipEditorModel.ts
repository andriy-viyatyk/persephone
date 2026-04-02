import React from "react";
import { TComponentState } from "../../core/state/state";
import { EditorModel, getDefaultEditorModelState } from "../base";
import type { IEditorState } from "../../../shared/types";
import type { ZipTreeProvider } from "../../content/tree-providers/ZipTreeProvider";
import { fpBasename } from "../../core/utils/file-path";
import { ArchiveIcon } from "../../theme/icons";
import { expandSecondaryPanel } from "../../core/state/events";

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
        // Set secondaryEditor via setter to register in secondaryModels[]
        // PageModel handles sidebar creation/restore.
        if (this.treeProvider && this.page?.hasSidebar) {
            this.secondaryEditor = "zip-tree";
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
            setTimeout(() => expandSecondaryPanel.send(this.id), 0);
        } else {
            this.secondaryEditor = undefined;
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
