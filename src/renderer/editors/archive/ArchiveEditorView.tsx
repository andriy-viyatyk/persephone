import { useCallback, useRef } from "react";
import { TreeProviderView, TreeProviderViewRef } from "../../components/tree-provider";
import { PageToolbar } from "../base/v4";
import { EditorToolbar } from "../base/EditorToolbar";
import { Panel } from "../../uikit/Panel";
import { IconButton } from "../../uikit/IconButton";
import { Text } from "../../uikit/Text";
import {
    CollapseAllIcon,
    RefreshIcon,
} from "../../theme/icons";
import { app } from "../../api/app";
import { pagesModel } from "../../api/pages";
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

    const v4Main = pagesModel.findPage(model.id)?.mainEditorV4 ?? null;

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
            name="archive-root"
            direction="column"
            flex={1}
            overflow="hidden"
            background="default"
        >
            {(() => {
                const rightActions = (
                    <>
                        <IconButton
                            name="archive-collapse-all"
                            size="sm"
                            title="Collapse All"
                            icon={<CollapseAllIcon />}
                            onClick={handleCollapseAll}
                        />
                        <IconButton
                            name="archive-refresh"
                            size="sm"
                            title="Refresh"
                            icon={<RefreshIcon />}
                            onClick={handleRefresh}
                        />
                    </>
                );
                return v4Main ? (
                    <PageToolbar
                        name="archive-toolbar"
                        model={v4Main}
                        borderBottom
                        rightContributions={rightActions}
                    />
                ) : (
                    <EditorToolbar borderBottom>{rightActions}</EditorToolbar>
                );
            })()}
            <TreeProviderView
                ref={treeRef}
                provider={provider}
                onItemClick={handleItemClick}
                onItemDoubleClick={handleItemClick}
            />
        </Panel>
    );
}
