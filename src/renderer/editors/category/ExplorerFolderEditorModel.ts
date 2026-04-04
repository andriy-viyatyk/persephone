import React from "react";
import { TComponentState } from "../../core/state/state";
import { EditorModel, getDefaultEditorModelState } from "../base";
import type { IEditorState } from "../../../shared/types";
import { FolderIcon } from "../../components/icons/FileIcon";
import { fpBasename } from "../../core/utils/file-path";
import {
    decodeCategoryLink,
    encodeCategoryLink,
    type ITreeProviderLink,
} from "../../content/tree-providers/tree-provider-link";

export interface ExplorerFolderEditorModelState extends IEditorState {
    type: "explorerFolder";
}

export function getDefaultExplorerFolderEditorModelState(): ExplorerFolderEditorModelState {
    return {
        ...getDefaultEditorModelState(),
        type: "explorerFolder",
    } as ExplorerFolderEditorModelState;
}

export class ExplorerFolderEditorModel extends EditorModel<ExplorerFolderEditorModelState> {
    constructor(state?: TComponentState<ExplorerFolderEditorModelState>) {
        super(state ?? new TComponentState(getDefaultExplorerFolderEditorModelState()));
        this.noLanguage = true;
        this.getIcon = () => React.createElement(
            "span",
            { style: { display: "inline-block", transform: "translate(-2px, -3px)" } },
            React.createElement(FolderIcon),
        );
    }

    /** Decoded category path from the tree-category:// link in filePath. */
    get categoryPath(): string {
        const link = this.decodedLink;
        return link?.category ?? "";
    }

    /** Decoded link metadata. Null if filePath is not a valid tree-category:// link. */
    get decodedLink(): ITreeProviderLink | null {
        const filePath = this.state.get().filePath;
        if (!filePath) return null;
        return decodeCategoryLink(filePath);
    }

    /** Initialize from an ITreeProviderLink (sets filePath and title). */
    initFromLink(link: ITreeProviderLink): void {
        const title = fpBasename(link.category) || link.category || "Folder";
        this.state.update((s) => {
            s.title = title;
            s.filePath = encodeCategoryLink(link);
        });
    }
}
