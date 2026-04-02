import { useCallback, useRef } from "react";
import styled from "@emotion/styled";
import { TreeProviderView, TreeProviderViewRef } from "../../components/tree-provider";
import { PageToolbar } from "../base/EditorToolbar";
import { Button } from "../../components/basic/Button";
import { FlexSpace } from "../../components/layout/Elements";
import {
    CollapseAllIcon,
    NavPanelIcon,
    RefreshIcon,
} from "../../theme/icons";
import { app } from "../../api/app";
import { RawLinkEvent } from "../../api/events/events";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { ZipEditorModel } from "./ZipEditorModel";
import color from "../../theme/color";

const ZipEditorViewRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: color.background.default,
});

export function ZipEditorView({ model }: { model: ZipEditorModel }) {
    const provider = model.treeProvider;
    const pageId = model.id;
    const treeRef = useRef<TreeProviderViewRef>(null);

    const handleItemClick = useCallback((item: ITreeProviderItem) => {
        const url = provider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            url, undefined, { pageId, sourceId: model.id },
        ));
    }, [provider, pageId, model.id]);

    const handleCollapseAll = useCallback(() => {
        treeRef.current?.collapseAll();
    }, []);

    const handleRefresh = useCallback(() => {
        treeRef.current?.refresh();
    }, []);

    const handleToggleNavigator = useCallback(() => {
        model.navigationData?.toggleNavigator();
    }, [model]);

    if (!provider) {
        return (
            <ZipEditorViewRoot>
                <div style={{ padding: 16, color: color.text.light }}>
                    No archive loaded.
                </div>
            </ZipEditorViewRoot>
        );
    }

    return (
        <ZipEditorViewRoot>
            <PageToolbar borderBottom>
                <Button
                    type="icon"
                    size="small"
                    title="File Explorer"
                    onClick={handleToggleNavigator}
                >
                    <NavPanelIcon />
                </Button>
                <FlexSpace />
                <Button
                    type="icon"
                    size="small"
                    title="Collapse All"
                    onClick={handleCollapseAll}
                >
                    <CollapseAllIcon width={14} height={14} />
                </Button>
                <Button
                    type="icon"
                    size="small"
                    title="Refresh"
                    onClick={handleRefresh}
                >
                    <RefreshIcon width={14} height={14} />
                </Button>
            </PageToolbar>
            <TreeProviderView
                ref={treeRef}
                provider={provider}
                onItemClick={handleItemClick}
                onItemDoubleClick={handleItemClick}
            />
        </ZipEditorViewRoot>
    );
}
