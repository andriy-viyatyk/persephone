import styled from "@emotion/styled";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { SecondaryEditorProps } from "../../../ui/navigation/secondary-editor-registry";
import type { TextFileModel } from "../../text/TextEditorModel";
import { useContentViewModel } from "../../base/useContentViewModel";
import { useOptionalState } from "../../../core/state/state";
import type { LinkViewModel } from "../LinkViewModel";
import type { ILink } from "../../../api/types/io.tree";
import { LinkTagsPanel } from "./LinkTagsPanel";
import { LinksList } from "../LinksList";
import RenderGridModel from "../../../components/virtualization/RenderGrid/RenderGridModel";
import { Splitter } from "../../../components/layout/Splitter";
import { app } from "../../../api/app";
import { createLinkData } from "../../../../shared/link-data";

// =============================================================================
// Styles
// =============================================================================

const NavigationPanelRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
    width: "100%",

    "& .tags-top": {
        flex: "1 1 auto",
        display: "flex",
        overflow: "hidden",
        minHeight: 40,
    },

    "& .tags-bottom": {
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },
});

// =============================================================================
// LinkTagsNavigationPanel — Tags panel with resizable bottom links list
// =============================================================================

interface LinkTagsNavigationPanelProps {
    vm: LinkViewModel;
    pageId?: string;
}

function LinkTagsNavigationPanel({ vm, pageId }: LinkTagsNavigationPanelProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<RenderGridModel>(null);
    const [bottomHeight, setBottomHeight] = useState<number | undefined>(undefined);

    const selectedTag = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get().selectedTag,
    );

    // Subscribe to data.links version so tagItems recalculates on link changes
    const links = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get().data.links,
    );

    // Subscribe to selectedLinkId as a primitive (guaranteed re-render on change)
    const selectedLinkId = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get().selectedLinkId,
    );

    const allTags = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get().tags,
    );

    const handleToggleTag = useCallback((item: ILink, tag: string) => {
        if (!item.id) return;
        const current = item.tags ?? [];
        const tags = current.includes(tag)
            ? current.filter((t) => t !== tag)
            : [...current, tag];
        vm.updateLink(item.id, { tags });
    }, [vm]);

    // Get items for the selected tag — all links, no audio filter.
    // Empty selectedTag = "All" — show all non-directory links (same as main LinksEditor).
    const tagItems = useMemo(() => {
        if (selectedTag) {
            return vm.treeProvider.getTagItems!(selectedTag)
                .filter((item) => !item.isDirectory);
        }
        return links.filter((item) => !item.isDirectory);
    }, [vm, selectedTag, links]);

    const handleSelect = useCallback((item: ILink) => {
        if (item.id) vm.selectLink(item.id);
        const navUrl = vm.treeProvider.getNavigationUrl(item);
        app.events.openRawLink.sendAsync(
            createLinkData(navUrl, {
                target: item.target || undefined,
                sourceId: "link-tag",
                selectedTag,
                ...(pageId ? { pageId, fallbackTarget: "monaco", title: item.title } : undefined),
            }),
        );
    }, [vm, selectedTag, pageId]);

    // Initialize bottom height to 50% of container, clamp to 80% max
    const handleChangeHeight = useCallback((h: number) => {
        const container = rootRef.current;
        if (container) {
            const maxH = container.clientHeight * 0.8;
            setBottomHeight(Math.max(40, Math.min(h, maxH)));
        } else {
            setBottomHeight(Math.max(40, h));
        }
    }, []);

    // Initialize bottom height to 50% of container after it finishes expanding.
    // The panel has an expand animation, so we debounce ResizeObserver to capture the final size.
    useEffect(() => {
        if (bottomHeight !== undefined || !rootRef.current) return;
        const el = rootRef.current;
        let timer: ReturnType<typeof setTimeout>;
        const observer = new ResizeObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const h = el.clientHeight;
                if (h > 0) {
                    setBottomHeight(Math.max(40, h * 0.5));
                    observer.disconnect();
                }
            }, 200);
        });
        observer.observe(el);
        return () => { clearTimeout(timer); observer.disconnect(); };
    }, [bottomHeight]);

    // Scroll selected item into view when selection changes (e.g., player auto-advances)
    useEffect(() => {
        if (!selectedLinkId || !gridRef.current) return;
        const row = tagItems.findIndex((item) => (item.id ?? item.href) === selectedLinkId);
        if (row >= 0) gridRef.current.scrollToRow(row, "nearest");
    }, [selectedLinkId, tagItems]);

    return (
        <NavigationPanelRoot ref={rootRef}>
            <div className="tags-top">
                <LinkTagsPanel vm={vm} />
            </div>
            {tagItems.length > 0 && (
                <>
                    <Splitter
                        type="horizontal"
                        initialHeight={bottomHeight ?? 150}
                        onChangeHeight={handleChangeHeight}
                        borderSized="top"
                    />
                    <div className="tags-bottom" style={{ height: bottomHeight ?? 150 }}>
                        <LinksList
                            ref={gridRef}
                            links={tagItems}
                            selectedId={selectedLinkId || undefined}
                            onSelect={handleSelect}
                            onDoubleClick={handleSelect}
                            allTags={allTags}
                            onToggleTag={handleToggleTag}
                        />
                    </div>
                </>
            )}
        </NavigationPanelRoot>
    );
}

// =============================================================================
// Secondary Editor wrapper
// =============================================================================

export default function LinkTagsSecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    const vm = useContentViewModel<LinkViewModel>(model as TextFileModel, "link-view");
    const mainEditorId = useOptionalState(model.page?.state, (s) => s.mainEditorId, null);
    const isMainEditor = mainEditorId === model.id;

    if (!vm) return null;

    return (
        <>
            {headerRef && createPortal(<>Tags</>, headerRef)}
            {isMainEditor
                ? <LinkTagsPanel vm={vm} />
                : <LinkTagsNavigationPanel vm={vm} pageId={model.page?.id} />
            }
        </>
    );
}
