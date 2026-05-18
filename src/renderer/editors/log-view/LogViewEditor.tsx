import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { TextFileModel } from "../text/TextEditorModel";
import { useContentViewModel } from "../base/useContentViewModel";
import { LogViewModel, LogViewState, defaultLogViewState } from "./LogViewModel";
import { LogViewProvider } from "./LogViewContext";
import { LogEntryWrapper } from "./LogEntryWrapper";
import { RenderFlexGrid, RenderGridModel } from "../../uikit/RenderGrid";
import type { RenderFlexCellParams, Percent } from "../../uikit/RenderGrid";
import { IconButton, Panel, Text } from "../../uikit";
import { EditorError } from "../base/EditorError";
import { showConfirmationDialog } from "../../ui/dialogs/ConfirmationDialog";

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

    const handleScroll = useCallback(() => {
        const container = gridModelRef.current?.containerRef?.current;
        if (!container) return;
        isAtBottom.current =
            container.scrollTop + container.clientHeight >= container.scrollHeight - AUTO_SCROLL_THRESHOLD;
    }, []);

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

    useEffect(() => {
        if (!vm) return;
        const count = state.entryCount;

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

    useEffect(() => {
        if (!vm || state.forceScrollVersion === 0) return;
        scheduleScrollToBottom();
    }, [vm, state.forceScrollVersion, scheduleScrollToBottom]);

    useEffect(() => {
        gridModelRef.current?.update({ all: true });
    }, [state.showTimestamps]);

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
                        <IconButton
                            name="log-clear"
                            size="sm"
                            icon={<ClearIcon />}
                            title="Clear log"
                            onClick={async () => {
                                const result = await showConfirmationDialog({
                                    message: "Clear all log entries?",
                                });
                                if (result === "Yes") vm.clear();
                            }}
                        />
                        <IconButton
                            name="log-toggle-timestamps"
                            size="sm"
                            icon={<TimestampIcon active={state.showTimestamps} />}
                            title={state.showTimestamps ? "Hide timestamps" : "Show timestamps"}
                            onClick={vm.toggleTimestamps}
                        />
                    </>,
                    model.editorToolbarRefLast!,
                )}
            <LogViewProvider value={vm}>
                <Panel name="log-view-root" direction="column" flex={1} overflow="hidden">
                    {state.error ? (
                        <EditorError>{state.error}</EditorError>
                    ) : state.entryCount === 0 ? (
                        <Panel name="log-view-placeholder" flex={1} align="center" justify="center">
                            <Text size="base" color="light">No log entries</Text>
                        </Panel>
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
                </Panel>
            </LogViewProvider>
        </>
    );
}
