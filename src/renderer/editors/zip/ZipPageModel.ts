import React from "react";
import { TComponentState } from "../../core/state/state";
import { PageModel, getDefaultPageModelState } from "../base";
import type { IEditorState } from "../../../shared/types";
import type { ZipTreeProvider } from "../../content/tree-providers/ZipTreeProvider";
import { fpBasename } from "../../core/utils/file-path";
import { ArchiveIcon } from "../../theme/icons";
import { expandSecondaryPanel } from "../../core/state/events";

export interface ZipPageModelState extends IEditorState {
    type: "zipFile";
    /** Archive source URL (path to the .zip file). */
    archiveUrl: string;
}

export function getDefaultZipPageModelState(): ZipPageModelState {
    return {
        ...getDefaultPageModelState(),
        type: "zipFile",
        archiveUrl: "",
    } as ZipPageModelState;
}

export class ZipPageModel extends PageModel<ZipPageModelState> {
    /** Tree provider for browsing archive contents. Owned by this model. */
    treeProvider: ZipTreeProvider | null = null;

    constructor(state?: TComponentState<ZipPageModelState>) {
        super(state ?? new TComponentState(getDefaultZipPageModelState()));
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
        // Ensure NavigationData exists — ZipPageModel always needs a sidebar.
        // On app restart: super.restore() already created it from cache.
        // On fresh open via openFile/createPageFromFile: create it here.
        // On _openZipArchive: restore() is not called (NavigationData created manually).
        if (!this.navigationData && archiveUrl) {
            const { NavigationData } = await import(
                "../../ui/navigation/NavigationData"
            );
            const { fpDirname } = await import("../../core/utils/file-path");
            const navData = new NavigationData(fpDirname(archiveUrl));
            navData.ensurePageNavigatorModel();
            navData.updateId(this.id);
            navData.flushSave();
            this.navigationData = navData;
            navData.setOwnerModel(this);
            this.state.update((s) => { s.hasNavigator = true; });
        }
        // Set secondaryEditor via setter to register in secondaryModels[]
        if (this.treeProvider && this.navigationData) {
            this.secondaryEditor = "zip-tree";
        }
    }

    /**
     * Navigation survival: keep this model as secondary editor if the new page
     * was opened from this archive (sourceLink.metadata.sourceId matches).
     */
    beforeNavigateAway(newModel: PageModel): void {
        if (this._isOpenedFromThisArchive(newModel)) return;
        this.secondaryEditor = undefined;
    }

    /**
     * Called when the owner page changes during navigation.
     * If the new owner was NOT opened from this archive, remove self from sidebar.
     */
    setOwnerPage(model: PageModel | null): void {
        super.setOwnerPage(model);
        if (!model || model === this) return;
        if (this._isOpenedFromThisArchive(model)) {
            setTimeout(() => expandSecondaryPanel.send(this.id), 0);
        } else {
            this.secondaryEditor = undefined;
        }
    }

    /** Check if a model was opened from this archive via sourceLink metadata. */
    private _isOpenedFromThisArchive(model: PageModel): boolean {
        return model.state.get().sourceLink?.metadata?.sourceId === this.id;
    }

    async dispose(): Promise<void> {
        this.treeProvider = null;
        await super.dispose();
    }

    applyRestoreData(data: Partial<ZipPageModelState>): void {
        super.applyRestoreData(data as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.archiveUrl) {
            this.state.update((s) => { s.archiveUrl = data.archiveUrl!; });
        }
    }

    getRestoreData(): Partial<ZipPageModelState> {
        return {
            ...super.getRestoreData(),
            archiveUrl: this.state.get().archiveUrl,
        };
    }
}
