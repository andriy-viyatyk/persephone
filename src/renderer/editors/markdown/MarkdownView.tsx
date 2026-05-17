import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { TextFileModel } from "../text";
import { CompactViewIcon, NormalViewIcon } from "../../theme/icons";
import { IconButton, Minimap, Panel } from "../../uikit";
import { useEditorConfig } from "../base";
import { FindBar } from "../shared/FindBar";
import {
    MarkdownViewModel,
    MarkdownViewState,
    defaultMarkdownViewState,
} from "./MarkdownViewModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { MarkdownBlock, MarkdownBlockHandle } from "./MarkdownBlock";

export interface MarkdownViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultMarkdownViewState;

export function MarkdownView({ model }: MarkdownViewProps) {
    const vm = useContentViewModel<MarkdownViewModel>(model, "md-view");
    const blockRef = useRef<MarkdownBlockHandle>(null);
    const editorConfig = useEditorConfig();

    const pageState: MarkdownViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );
    const { content, filePath } = model.state.use((s) => ({
        content: s.content,
        filePath: s.filePath,
    }));

    // Determine effective highlight text: own search takes priority, then external
    const highlightText = pageState.searchVisible && pageState.searchText
        ? pageState.searchText
        : editorConfig.highlightText || "";

    // Sync match count from MarkdownBlock handle to ViewModel
    const onMatchCountChange = useCallback((count: number) => {
        if (!vm) return;
        const { totalMatches, currentMatchIndex } = vm.state.get();
        if (count !== totalMatches) {
            const newIndex = count > 0 && currentMatchIndex >= count ? 0 : currentMatchIndex;
            vm.state.update((s) => {
                s.totalMatches = count;
                s.currentMatchIndex = newIndex;
            });
            if (count > 0) {
                blockRef.current?.scrollToMatch(newIndex);
            }
        }
    }, [vm]);

    // Navigate to match when currentMatchIndex changes (from next/prev)
    useEffect(() => {
        if (pageState.totalMatches > 0) {
            blockRef.current?.scrollToMatch(pageState.currentMatchIndex);
        }
    }, [pageState.currentMatchIndex]);

    // Keyboard handler for search shortcuts
    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            vm.openSearch();
        } else if (e.key === "Escape" && pageState.searchVisible) {
            e.preventDefault();
            vm.closeSearch();
        } else if (e.key === "F3" && e.shiftKey) {
            e.preventDefault();
            vm.prevMatch();
        } else if (e.key === "F3") {
            e.preventDefault();
            vm.nextMatch();
        }
    }, [vm, pageState.searchVisible]);

    const showMinimap = !editorConfig.hideMinimap;
    const compact = editorConfig.compact || pageState.compactMode;

    // Only show own search bar when not embedded with external highlight
    const showSearchBar = pageState.searchVisible && !editorConfig.highlightText;

    if (!vm) return null;

    return (
        <>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <IconButton
                        name="markdown-compact-toggle"
                        size="sm"
                        active={pageState.compactMode}
                        title={pageState.compactMode ? "Normal View" : "Compact View"}
                        icon={pageState.compactMode ? <NormalViewIcon /> : <CompactViewIcon />}
                        onClick={vm.toggleCompact}
                    />,
                    model.editorToolbarRefLast,
                )}
            <Panel
                name="markdown-view-root"
                direction="row"
                flex={1}
                height={0}
                overflow="hidden"
                maxHeight={editorConfig.maxEditorHeight}
                tabIndex={-1}
                onKeyDown={onKeyDown}
            >
                <Panel
                    name="markdown-find-column"
                    direction="column"
                    flex={1}
                    width={0}
                >
                    {showSearchBar && (
                        <FindBar
                            text={pageState.searchText}
                            currentMatch={pageState.currentMatchIndex}
                            totalMatches={pageState.totalMatches}
                            onTextChange={vm.setSearchText}
                            onNext={vm.nextMatch}
                            onPrev={vm.prevMatch}
                            onClose={vm.closeSearch}
                        />
                    )}
                    <Panel
                        name="markdown-scroll"
                        direction="column"
                        flex={1}
                        height={0}
                        overflowY="auto"
                        overflowX="hidden"
                        scrollbar={showMinimap ? "hidden" : "auto"}
                        paddingX={compact ? "md" : "xxl"}
                        ref={vm.setContainer}
                        onScroll={vm.containerScroll}
                    >
                        <MarkdownBlock
                            ref={blockRef}
                            content={content}
                            highlightText={highlightText}
                            compact={compact}
                            filePath={filePath}
                            onMatchCountChange={onMatchCountChange}
                        />
                    </Panel>
                </Panel>
                {showMinimap && (
                    <Minimap
                        name="markdown-minimap"
                        scrollContainer={pageState.container}
                    />
                )}
            </Panel>
        </>
    );
}

const moduleExport = {
    Editor: MarkdownView,
};

export default moduleExport;
