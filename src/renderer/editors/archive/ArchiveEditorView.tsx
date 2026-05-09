import { useCallback, useRef } from "react";
import { TreeProviderView, TreeProviderViewRef } from "../../components/tree-provider";
import { PageToolbar } from "../base/EditorToolbar";
import { Panel } from "../../uikit/Panel";
import { IconButton } from "../../uikit/IconButton";
import { Spacer } from "../../uikit/Spacer";
import { Text } from "../../uikit/Text";
import {
    CollapseAllIcon,
    NavPanelIcon,
    RefreshIcon,
} from "../../theme/icons";
import { app } from "../../api/app";
import { createLinkData } from "../../../shared/link-data";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { ArchiveEditorModel } from "./ArchiveEditorModel";

export function ArchiveEditorView({ model }: { model: ArchiveEditorModel }) {
    const provider = model.treeProvider;
    const pageId = model.page?.id ?? model.id;
    const treeRef = useRef<TreeProviderViewRef>(null);

    const handleItemClick = useCallback((item: ITreeProviderItem) => {
        const url = provider?.getNavigationUrl(item) ?? item.href;
        app.events.openRawLink.sendAsync(createLinkData(url, { pageId, sourceId: model.id }));
    }, [provider, pageId, model.id]);

    const handleCollapseAll = useCallback(() => {
        treeRef.current?.collapseAll();
    }, []);

    const handleRefresh = useCallback(() => {
        treeRef.current?.refresh();
    }, []);

    const handleToggleNavigator = useCallback(() => {
        model.page?.toggleNavigator();
    }, [model]);

    if (!provider) {
        return (
            <Panel
                direction="column"
                flex={1}
                overflow="hidden"
                background="default"
                padding="xl"
            >
                <Text color="light">No archive loaded.</Text>
            </Panel>
        );
    }

    return (
        <Panel
            direction="column"
            flex={1}
            overflow="hidden"
            background="default"
        >
            <PageToolbar borderBottom>
                <IconButton
                    size="sm"
                    title="File Explorer"
                    icon={<NavPanelIcon />}
                    onClick={handleToggleNavigator}
                />
                <Spacer />
                <IconButton
                    size="sm"
                    title="Collapse All"
                    icon={<CollapseAllIcon />}
                    onClick={handleCollapseAll}
                />
                <IconButton
                    size="sm"
                    title="Refresh"
                    icon={<RefreshIcon />}
                    onClick={handleRefresh}
                />
            </PageToolbar>
            <TreeProviderView
                ref={treeRef}
                provider={provider}
                onItemClick={handleItemClick}
                onItemDoubleClick={handleItemClick}
            />
        </Panel>
    );
}
