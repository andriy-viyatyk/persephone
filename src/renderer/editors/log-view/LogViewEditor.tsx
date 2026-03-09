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
const getColumnWidth = () => "100%" as Percent;
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

    // Grid update + auto-scroll on entry count change
    useEffect(() => {
        if (!vm) return;
        const count = state.entryCount;

        gridModelRef.current?.update({ all: true });

        if (count > prevEntryCount.current && isAtBottom.current && count > 0) {
            gridModelRef.current?.scrollToRow(count - 1, "bottom");
        }

        prevEntryCount.current = count;
    }, [vm, state.entryCount]);

    // Re-render grid when timestamps toggled (row heights change)
    useEffect(() => {
        gridModelRef.current?.update({ all: true });
    }, [state.showTimestamps]);

    // Render cell callback
    const renderLogEntry = useCallback(
        (p: RenderFlexCellParams) => {
            if (!vm) return null;
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
                    <Button
                        size="small"
                        type="icon"
                        title={state.showTimestamps ? "Hide timestamps" : "Show timestamps"}
                        onClick={vm.toggleTimestamps}
                    >
                        <TimestampIcon active={state.showTimestamps} />
                    </Button>,
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
                            columnCount={1}
                            rowCount={state.entryCount}
                            columnWidth={getColumnWidth}
                            renderCell={renderLogEntry}
                            fitToWidth
                            minRowHeight={18}
                            getInitialRowHeight={getInitialRowHeight}
                        />
                    )}
                </LogViewRoot>
            </LogViewProvider>
        </>
    );
}
