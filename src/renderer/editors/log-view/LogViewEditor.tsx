import styled from "@emotion/styled";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { TextFileModel } from "../text/TextPageModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { LogViewModel, LogViewState, defaultLogViewState } from "./LogViewModel";
import { LogViewProvider } from "./LogViewContext";
import { LogEntryWrapper } from "./LogEntryWrapper";
import { RenderFlexGrid, RenderFlexCellParams } from "../../components/virtualization/RenderGrid/RenderFlexGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { Percent } from "../../components/virtualization/RenderGrid/types";
import { Button } from "../../components/basic/Button";
import { EditorError } from "../base/EditorError";
import color from "../../theme/color";

// =============================================================================
// Styled Components
// =============================================================================

const LogViewRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    overflow: "hidden",
    "& .log-view-placeholder": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "1 1 auto",
        color: color.text.light,
        fontSize: 14,
    },
});

// =============================================================================
// Constants
// =============================================================================

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultLogViewState;
const RIGHT_GUTTER = 40;
const getColumnWidth = (col: number) => col === 0 ? "100%" as Percent : RIGHT_GUTTER;
const AUTO_SCROLL_THRESHOLD = 50;

// =============================================================================
// Icons
// =============================================================================

function TimestampIcon({ active }: { active: boolean }) {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1" opacity={active ? 1 : 0.5} />
            <polyline points="8,4 8,8 11,10" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity={active ? 1 : 0.5} />
        </svg>
    );
}

function ClearIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 5h8M2 8h5M2 11h3M10.5 5.5l4 4M14.5 5.5l-4 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
    );
}

// =============================================================================
// Component
// =============================================================================

export function LogViewEditor({ model }: { model: TextFileModel }) {
    const vm = useContentViewModel<LogViewModel>(model, "log-view");

    const state: LogViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    const gridModelRef = useRef<RenderGridModel | null>(null);
    const isAtBottom = useRef(true);
    const prevEntryCount = useRef(0);
    const scrollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

    const setGridModel = useCallback((m: RenderGridModel | null) => {
        gridModelRef.current = m;
    }, []);

    // Track scroll position to know if user is at bottom
    const handleScroll = useCallback(() => {
        const container = gridModelRef.current?.containerRef?.current;
        if (!container) return;
        isAtBottom.current =
            container.scrollTop + container.clientHeight >= container.scrollHeight - AUTO_SCROLL_THRESHOLD;
    }, []);

    // Attach scroll listener when grid mounts (depends on entryCount for mount/unmount transitions)
    useEffect(() => {
        const container = gridModelRef.current?.containerRef?.current;
        if (!container) return;
        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => container.removeEventListener("scroll", handleScroll);
    }, [vm, state.entryCount, handleScroll]);

    // Iterative auto-scroll: RenderFlexGrid renders new rows at minRowHeight
    // (preferMinHeightForNewRows), then ResizeObserver measures actual content and
    // grows rows asynchronously. A single scroll-to-bottom fires before these height
    // adjustments settle, so the last row ends up partially hidden. We scroll multiple
    // times with increasing delays to compensate for each measurement pass.
    // Three follow-ups (50/150/300ms) reliably cover multi-row batches where each
    // row's ResizeObserver fires at slightly different times.
    const scheduleScrollToBottom = useCallback(() => {
        for (const t of scrollTimers.current) clearTimeout(t);
        const count = prevEntryCount.current;
        if (count <= 0) return;
        const scrollToEnd = () => gridModelRef.current?.scrollToRow(count - 1, "bottom");
        scrollToEnd();
        const t1 = setTimeout(scrollToEnd, 50);
        const t2 = setTimeout(scrollToEnd, 150);
        const t3 = setTimeout(scrollToEnd, 300);
        scrollTimers.current = [t1, t2, t3];
    }, []);

    // Grid update + auto-scroll on entry count change
    useEffect(() => {
        if (!vm) return;
        const count = state.entryCount;

        // Clear any pending scroll timers from previous update
        for (const t of scrollTimers.current) clearTimeout(t);
        scrollTimers.current = [];

        gridModelRef.current?.update({ all: true });

        if (count > prevEntryCount.current && isAtBottom.current && count > 0) {
            prevEntryCount.current = count;
            scheduleScrollToBottom();
        } else {
            prevEntryCount.current = count;
        }

        return () => {
            for (const t of scrollTimers.current) clearTimeout(t);
            scrollTimers.current = [];
        };
    }, [vm, state.entryCount, scheduleScrollToBottom]);

    // Force scroll-to-bottom when a dialog entry is added (user must see it to respond)
    useEffect(() => {
        if (!vm || state.forceScrollVersion === 0) return;
        scheduleScrollToBottom();
    }, [vm, state.forceScrollVersion, scheduleScrollToBottom]);

    // Re-render grid when timestamps toggled (row heights change)
    useEffect(() => {
        gridModelRef.current?.update({ all: true });
    }, [state.showTimestamps]);

    // Render cell callback
    const renderLogEntry = useCallback(
        (p: RenderFlexCellParams) => {
            if (!vm || p.col === 1) return null;
            return (
                <LogEntryWrapper
                    vm={vm}
                    index={p.row}
                    cellRef={p.ref}
                    showTimestamp={state.showTimestamps}
                />
            );
        },
        [vm, state.showTimestamps],
    );

    // Initial row height from cache
    const getInitialRowHeight = useCallback(
        (row: number) => {
            if (!vm) return undefined;
            const entries = vm.state.get().entries;
            const entry = entries[row];
            if (!entry) return undefined;
            return vm.getEntryHeight(entry.id);
        },
        [vm],
    );

    if (!vm) return null;

    return (
        <>
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <>
                        <Button
                            size="small"
                            type="icon"
                            title="Clear log"
                            onClick={vm.clear}
                        >
                            <ClearIcon />
                        </Button>
                        <Button
                            size="small"
                            type="icon"
                            title={state.showTimestamps ? "Hide timestamps" : "Show timestamps"}
                            onClick={vm.toggleTimestamps}
                        >
                            <TimestampIcon active={state.showTimestamps} />
                        </Button>
                    </>,
                    model.editorToolbarRefLast!,
                )}
            <LogViewProvider value={vm}>
                <LogViewRoot>
                    {state.error ? (
                        <EditorError>{state.error}</EditorError>
                    ) : state.entryCount === 0 ? (
                        <div className="log-view-placeholder">No log entries</div>
                    ) : (
                        <RenderFlexGrid
                            ref={setGridModel}
                            columnCount={2}
                            rowCount={state.entryCount}
                            columnWidth={getColumnWidth}
                            renderCell={renderLogEntry}
                            fitToWidth
                            minRowHeight={18}
                            getInitialRowHeight={getInitialRowHeight}
                            preferMinHeightForNewRows
                        />
                    )}
                </LogViewRoot>
            </LogViewProvider>
        </>
    );
}
