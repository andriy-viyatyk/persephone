import styled from "@emotion/styled";
import { TextFileModel } from "../text";
import { CompactViewIcon, NormalViewIcon } from "../../theme/icons";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Minimap } from "../../components/layout/Minimap";
import { useEditorConfig } from "../base";
import { Button } from "../../components/basic/Button";
import { MarkdownSearchBar } from "./MarkdownSearchBar";
import { MarkdownViewModel, MarkdownViewState, defaultMarkdownViewState } from "./MarkdownViewModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { MarkdownBlock, MarkdownBlockHandle } from "./MarkdownBlock";

const MdViewRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "row",
    overflow: "hidden",
    outline: "none",
    "& .md-scroll-container": {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        padding: "0 24px",
        overflowY: "auto",
        overflowX: "hidden",
        "&::-webkit-scrollbar": {
            display: "none",
        },
    },
    // Show scrollbar when minimap is hidden
    "&.show-scrollbar .md-scroll-container::-webkit-scrollbar": {
        display: "block",
        width: 8,
    },
    // Compact mode — reduced padding for scroll container
    "&.compact .md-scroll-container": {
        padding: "0 8px",
    },
});

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
            // Navigate to current match after count update
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

    // Apply max height constraint from context (e.g., when embedded in notebook)
    const rootStyle = editorConfig.maxEditorHeight
        ? { maxHeight: editorConfig.maxEditorHeight }
        : undefined;

    const showMinimap = !editorConfig.hideMinimap;
    const compact = editorConfig.compact || pageState.compactMode;

    // Only show own search bar when not embedded with external highlight
    const showSearchBar = pageState.searchVisible && !editorConfig.highlightText;

    if (!vm) return null;

    return (
        <>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <Button
                        size="small"
                        type="icon"
                        title={pageState.compactMode ? "Normal View" : "Compact View"}
                        onClick={vm.toggleCompact}
                    >
                        {pageState.compactMode ? <NormalViewIcon /> : <CompactViewIcon />}
                    </Button>,
                    model.editorToolbarRefLast,
                )}
            <MdViewRoot
                style={rootStyle}
                className={`${showMinimap ? "" : "show-scrollbar"} ${compact ? "compact" : ""}`}
                onKeyDown={onKeyDown}
                tabIndex={-1}
            >
                {showSearchBar && (
                    <MarkdownSearchBar
                        searchText={pageState.searchText}
                        currentMatch={pageState.currentMatchIndex}
                        totalMatches={pageState.totalMatches}
                        onSearchTextChange={vm.setSearchText}
                        onNext={vm.nextMatch}
                        onPrev={vm.prevMatch}
                        onClose={vm.closeSearch}
                    />
                )}
                <div
                    className="md-scroll-container"
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
                </div>
                {showMinimap && (
                    <Minimap
                        scrollContainer={pageState.container}
                        className="md-minimap"
                    />
                )}
            </MdViewRoot>
        </>
    );
}

const moduleExport = {
    Editor: MarkdownView,
};

export default moduleExport;

// Re-export with old names for backward compatibility
export { MarkdownView as MdView };
export type { MarkdownViewProps as MdViewProps };
