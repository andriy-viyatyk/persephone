import React, { useCallback } from "react";
import { createPortal } from "react-dom";
import { FileSearch } from "../../components/file-search";
import { app } from "../../api/app";
import { createLinkData } from "../../../shared/link-data";
import type { SecondaryEditorProps } from "../../ui/navigation/secondary-editor-registry";
import type { ExplorerEditorModel } from "./ExplorerEditorModel";
import { Button } from "../../components/basic/Button";
import { CloseIcon } from "../../theme/icons";
import { fpBasename } from "../../core/utils/file-path";

export default function SearchSecondaryEditor({ model: rawModel, headerRef }: SecondaryEditorProps) {
    const model = rawModel as ExplorerEditorModel;
    const rootPath = model.rootPath;
    const pageId = model.page?.id ?? "";

    const searchFolder = model.searchState?.searchFolder || rootPath;
    const searchFolderName = fpBasename(searchFolder);

    const handleSearchResultClick = useCallback((filePath: string, lineNumber?: number) => {
        model.setSelectedHref(filePath);
        app.events.openRawLink.sendAsync(createLinkData(filePath, {
            pageId,
            ...(lineNumber ? { revealLine: lineNumber, highlightText: model.searchState?.query } : undefined),
        }));
    }, [pageId, model]);

    const headerContent = (
        <>
            <span title={searchFolder} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Search [{searchFolderName}]
            </span>
            <span className="panel-spacer" />
            <Button type="icon" size="small" title="Close Search"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); model.closeSearch(); }}>
                <CloseIcon width={14} height={14} />
            </Button>
        </>
    );

    return (
        <>
            {headerRef && createPortal(headerContent, headerRef)}
            <FileSearch
                folder={rootPath}
                state={model.searchState}
                onStateChange={model.setSearchState}
                onResultClick={handleSearchResultClick}
            />
        </>
    );
}
