import styled from "@emotion/styled";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TextFileModel } from "../text/TextPageModel";
import { CircularProgress } from "../../components/basic/CircularProgress";
import { EditorError } from "../base/EditorError";
import { useContentViewModel } from "../base/useContentViewModel";
import { GraphViewModel, GraphViewState, SearchResult, defaultGraphViewState } from "./GraphViewModel";
import { GraphTooltip } from "./GraphTooltip";
import { GraphDetailPanel } from "./GraphDetailPanel";
import { GraphTuningSliders } from "./GraphTuningSliders";
import { GraphExpansionSettings } from "./GraphExpansionSettings";
import { GraphLegendPanel } from "./GraphLegendPanel";
import { highlightText } from "../../components/basic/useHighlightedText";
import { SettingsIcon, RefreshIcon, ExpandAllIcon } from "../../theme/icons";
import { showConfirmationDialog } from "../../ui/dialogs/ConfirmationDialog";
import color from "../../theme/color";

// ============================================================================
// Constants
// ============================================================================

type ToolbarPanel = "closed" | "settings" | "expansion" | "results";
const MAX_DISPLAYED_RESULTS = 100;

// ============================================================================
// Styled Components
// ============================================================================

const GraphViewRoot = styled.div({
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    overflow: "hidden",
    position: "relative",
    "& .graph-loading": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "1 1 auto",
        backgroundColor: color.graph.background,
    },
    "& .graph-canvas": {
        width: "100%",
        height: "100%",
        flex: "1 1 auto",
        backgroundColor: color.graph.background,
    },
    "& .graph-toolbar": {
        position: "absolute",
        top: 8,
        left: 8,
        display: "flex",
        flexDirection: "column" as const,
        width: 280,
        backgroundColor: color.graph.background,
        border: `1px solid ${color.border.default}`,
        borderRadius: 4,
        zIndex: 1,
        opacity: 0.5,
        transition: "opacity 0.15s",
        "&:hover, &.expanded, &:focus-within, &.has-search": {
            opacity: 1,
        },
        "&.expanded": {
            borderColor: color.graph.nodeHighlight,
        },
    },
    "& .graph-toolbar-row": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: 2,
    },
    "& .graph-icon-btn": {
        width: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "pointer",
        border: `1px solid transparent`,
        borderRadius: 3,
        backgroundColor: "transparent",
        color: color.graph.labelText,
        padding: 0,
        "&:hover": {
            borderColor: color.graph.nodeHighlight,
        },
        "&.active": {
            borderColor: color.graph.nodeHighlight,
        },
        "&.disabled": {
            opacity: 0.3,
            pointerEvents: "none" as const,
        },
    },
    "& .graph-search-wrap": {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
    },
    "& .graph-search-input": {
        width: "100%",
        padding: "2px 18px 2px 6px",
        fontSize: 11,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        backgroundColor: color.graph.background,
        color: color.graph.labelText,
        outline: "none",
        "&:focus": {
            borderColor: color.graph.nodeHighlight,
        },
        "&::placeholder": {
            color: color.text.light,
        },
    },
    "& .graph-search-clear": {
        position: "absolute",
        right: 3,
        top: "50%",
        transform: "translateY(-50%)",
        width: 14,
        height: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        fontSize: 12,
        lineHeight: 1,
        color: color.border.default,
        borderRadius: 2,
        "&:hover": {
            color: color.graph.labelText,
        },
    },
    "& .graph-search-wrap:hover .graph-search-clear, & .graph-search-input:focus ~ .graph-search-clear": {
        color: color.graph.labelText,
    },
    "& .has-search .graph-search-input": {
        color: color.graph.nodeHighlight,
    },
    "& .has-search .graph-search-clear": {
        color: color.graph.nodeHighlight,
    },
    "& .graph-search-info": {
        fontSize: 11,
        color: color.graph.labelText,
        whiteSpace: "nowrap",
        flexShrink: 0,
    },
    // Toolbar tabs
    "& .toolbar-tabs": {
        display: "flex",
        borderBottom: `1px solid ${color.border.default}`,
        backgroundColor: color.background.dark,
    },
    "& .toolbar-tab": {
        padding: "3px 8px",
        fontSize: 11,
        cursor: "pointer",
        color: color.graph.labelText,
        borderBottom: "2px solid transparent",
        backgroundColor: "transparent",
        border: "none",
        borderBottomWidth: 2,
        borderBottomStyle: "solid" as const,
        borderBottomColor: "transparent",
        "&.active": {
            borderBottomColor: color.graph.nodeHighlight,
        },
        "&:hover:not(.active)": {
            borderBottomColor: color.border.default,
        },
    },
    // Search results panel
    "& .search-results": {
        maxHeight: 300,
        overflowY: "auto" as const,
    },
    "& .search-result-row": {
        padding: "3px 8px",
        cursor: "pointer",
        fontSize: 11,
        lineHeight: 1.4,
        borderBottom: `1px solid ${color.border.default}`,
        "&:last-child": {
            borderBottom: "none",
        },
        "&:hover": {
            backgroundColor: color.background.selection,
        },
        "&.keyboard-selected": {
            backgroundColor: color.background.selection,
        },
        "&.hidden-node": {
            opacity: 0.5,
        },
    },
    "& .search-result-title": {
        fontWeight: 600,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "& .search-result-prop": {
        fontStyle: "italic",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "& .search-result-prop-key": {
        opacity: 0.6,
    },
    "& .search-status-bar": {
        padding: "3px 8px",
        fontSize: 11,
        color: color.graph.labelText,
        borderTop: `1px solid ${color.border.default}`,
        display: "flex",
        justifyContent: "space-between",
    },
    "& .search-reveal": {
        cursor: "pointer",
        color: color.graph.nodeHighlight,
        "&:hover": {
            textDecoration: "underline",
        },
    },
    "& .search-no-results": {
        padding: 8,
        fontSize: 11,
        opacity: 0.5,
        textAlign: "center" as const,
    },
    "& .graph-empty-hint": {
        position: "absolute",
        top: 48,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        color: color.graph.labelText,
        opacity: 0.5,
        fontSize: 12,
    },
    // Legend panel (bottom-left)
    "& .graph-legend": {
        position: "absolute",
        bottom: 8,
        left: 8,
        width: 260,
        display: "flex",
        flexDirection: "column" as const,
        backgroundColor: color.graph.background,
        border: `1px solid ${color.border.default}`,
        borderRadius: 4,
        zIndex: 1,
        opacity: 0.5,
        transition: "opacity 0.15s",
        "&:hover, &.expanded, &:focus-within": {
            opacity: 1,
        },
    },
    "& .legend-header": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "3px 8px",
        cursor: "pointer",
        userSelect: "none" as const,
    },
    "& .legend-title": {
        fontSize: 11,
        fontWeight: 600,
        color: color.graph.labelText,
    },
    "& .legend-chevron": {
        fontSize: 11,
        color: color.graph.labelText,
        opacity: 0.6,
        "&.expanded": {
            color: color.graph.nodeHighlight,
            opacity: 1,
        },
    },
    "& .legend-tabs": {
        display: "flex",
        borderBottom: `1px solid ${color.border.default}`,
        backgroundColor: color.background.dark,
    },
    "& .legend-tab": {
        padding: "3px 8px",
        fontSize: 11,
        cursor: "pointer",
        color: color.graph.labelText,
        backgroundColor: "transparent",
        border: "none",
        borderBottomWidth: 2,
        borderBottomStyle: "solid" as const,
        borderBottomColor: "transparent",
        "&.active": {
            borderBottomColor: color.graph.nodeHighlight,
        },
        "&:hover:not(.active)": {
            borderBottomColor: color.border.default,
        },
    },
    "& .legend-content": {
        maxHeight: 250,
        overflowY: "auto" as const,
        padding: "2px 0",
    },
    "& .legend-row": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        fontSize: 11,
    },
    "& .legend-checkbox": {
        margin: 0,
        flexShrink: 0,
        cursor: "pointer",
    },
    "& .legend-icon": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: 16,
        height: 16,
        color: color.graph.labelText,
    },
    "& .legend-label": {
        fontSize: 11,
        color: color.graph.labelText,
        flexShrink: 0,
        minWidth: 50,
    },
    "& .legend-description": {
        flex: 1,
        minWidth: 0,
        padding: "1px 4px",
        fontSize: 11,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        backgroundColor: color.graph.background,
        color: color.graph.labelText,
        outline: "none",
        "&:focus": {
            borderColor: color.graph.nodeHighlight,
        },
        "&::placeholder": {
            color: color.text.light,
        },
    },
});

// ============================================================================
// GraphSearchResults Component
// ============================================================================

interface GraphSearchResultsProps {
    results: SearchResult[];
    searchQuery: string;
    selectedIndex: number;
    onSelect: (nodeId: string) => void;
}

function GraphSearchResults({ results, searchQuery, selectedIndex, onSelect }: GraphSearchResultsProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const truncated = results.length > MAX_DISPLAYED_RESULTS;
    const displayed = truncated ? results.slice(0, MAX_DISPLAYED_RESULTS) : results;

    // Scroll keyboard-selected item into view
    useEffect(() => {
        if (selectedIndex < 0 || !listRef.current) return;
        const row = listRef.current.children[selectedIndex] as HTMLElement | undefined;
        row?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex]);

    return (
        <div className="search-results" ref={listRef}>
            {displayed.map((result, i) => (
                <div
                    key={result.nodeId}
                    className={`search-result-row${!result.visible ? " hidden-node" : ""}${i === selectedIndex ? " keyboard-selected" : ""}`}
                    onClick={() => onSelect(result.nodeId)}
                >
                    <div className="search-result-title">
                        {highlightText(searchQuery, result.label)}
                    </div>
                    {result.matchedProps.map((prop) => (
                        <div key={prop.key} className="search-result-prop">
                            <span className="search-result-prop-key">
                                {highlightText(searchQuery, prop.key)}
                            </span>
                            {": "}
                            {highlightText(searchQuery, prop.value)}
                        </div>
                    ))}
                </div>
            ))}
            {truncated && (
                <div className="search-no-results">
                    and {results.length - MAX_DISPLAYED_RESULTS} more...
                </div>
            )}
        </div>
    );
}

// ============================================================================
// GraphView Component
// ============================================================================

interface GraphViewProps {
    model: TextFileModel;
}

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultGraphViewState;

function GraphView({ model }: GraphViewProps) {
    const vm = useContentViewModel<GraphViewModel>(model, "graph-view");
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [toolbarPanel, setToolbarPanel] = useState<ToolbarPanel>("closed");
    const [expandRequest, setExpandRequest] = useState(0);
    const [collapseRequest, setCollapseRequest] = useState(0);
    const [selectedResultIndex, setSelectedResultIndex] = useState(-1);
    const panelDirtyRef = useRef(false);
    const panelExpandedRef = useRef(false);

    const toggleSettings = useCallback(() => {
        setToolbarPanel((prev) => prev === "settings" ? "closed" : "settings");
    }, []);

    // Double-click on node → expand detail panel
    useEffect(() => {
        if (!vm) return;
        vm.onDoubleClickNode = () => setExpandRequest((n) => n + 1);
        return () => { vm.onDoubleClickNode = null; };
    }, [vm]);

    const pageState: GraphViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    // Refresh resolved canvas colors when component re-renders (theme changes cause re-render)
    useEffect(() => {
        vm?.refreshColors();
    });

    // Auto-switch to results tab when search results appear
    const { searchQuery, searchInfo, searchResults, tooltip, selectedNodes, linkedNodes, statusHint } = pageState;
    useEffect(() => {
        if (searchResults && searchResults.length > 0) {
            setToolbarPanel("results");
            setSelectedResultIndex(-1);
        } else if (!searchQuery) {
            // Search cleared — close results panel (but keep settings if open)
            setToolbarPanel((prev) => prev === "results" ? "closed" : prev);
        }
    }, [searchResults, searchQuery]);

    const onSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        vm?.setSearchQuery(e.target.value);
    }, [vm]);

    const onSelectResult = useCallback((nodeId: string) => {
        vm?.revealAndSelectNode(nodeId);
    }, [vm]);

    const onSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        const results = vm?.state.get().searchResults;
        const count = results?.length ?? 0;

        if (e.key === "ArrowDown" && count > 0) {
            e.preventDefault();
            setSelectedResultIndex((prev) => (prev + 1) % Math.min(count, MAX_DISPLAYED_RESULTS));
        } else if (e.key === "ArrowUp" && count > 0) {
            e.preventDefault();
            const max = Math.min(count, MAX_DISPLAYED_RESULTS);
            setSelectedResultIndex((prev) => (prev - 1 + max) % max);
        } else if (e.key === "Enter" && results && count > 0) {
            e.preventDefault();
            const idx = selectedResultIndex >= 0 ? selectedResultIndex : 0;
            if (idx < count) {
                onSelectResult(results[idx].nodeId);
            }
        } else if (e.key === "Escape") {
            if (toolbarPanel !== "closed") {
                setToolbarPanel("closed");
            } else {
                vm?.setSearchQuery("");
                if (inputRef.current) inputRef.current.value = "";
                inputRef.current?.blur();
            }
        }
    }, [vm, selectedResultIndex, toolbarPanel, onSelectResult]);

    const onSearchClear = useCallback(() => {
        vm?.setSearchQuery("");
        if (inputRef.current) inputRef.current.value = "";
        inputRef.current?.focus();
    }, [vm]);

    const onSearchFocus = useCallback(() => {
        const results = vm?.state.get().searchResults;
        if (results && results.length > 0) {
            setToolbarPanel("results");
        }
    }, [vm]);

    const onRevealHidden = useCallback(() => {
        vm?.revealHiddenMatches();
    }, [vm]);

    const handleExpandAll = useCallback(async () => {
        if (!vm) return;
        if (vm.totalNodeCount > 1000) {
            const result = await showConfirmationDialog({
                title: "Expand All Nodes",
                message: `This graph has ${vm.totalNodeCount} nodes. Expanding all may cause performance issues. Continue?`,
            });
            if (result !== "Yes") return;
        }
        vm.expandAll();
    }, [vm]);

    const canvasRef = useCallback((el: HTMLCanvasElement | null) => {
        vm?.renderer.setCanvas(el);
    }, [vm]);

    const onPanelDirtyChange = useCallback((dirty: boolean) => {
        panelDirtyRef.current = dirty;
    }, []);

    const onPanelExpandedChange = useCallback((exp: boolean) => {
        panelExpandedRef.current = exp;
    }, []);

    // Capture-phase mousedown to dismiss open popups (e.g. quick-add menu).
    // D3 zoom/drag calls stopImmediatePropagation() on canvas mousedown, preventing
    // it from bubbling to document where Popper's click-outside listener lives.
    const onMouseDownCapture = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) return; // only for child elements (canvas)
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }, []);

    if (!vm) return null;

    const { error, loading } = pageState;
    const isExpanded = toolbarPanel !== "closed";
    const resultCount = searchResults?.length ?? 0;

    return (
        <GraphViewRoot ref={containerRef} onMouseDownCapture={onMouseDownCapture}>
            {error && <EditorError>{error}</EditorError>}
            {loading ? (
                <div className="graph-loading">
                    <CircularProgress />
                </div>
            ) : (
                <>
                    <canvas
                        className="graph-canvas"
                        ref={canvasRef}
                        onClick={(e) => {
                            if (panelDirtyRef.current) return;
                            if (isExpanded || panelExpandedRef.current) {
                                setToolbarPanel("closed");
                                setCollapseRequest((n) => n + 1);
                                return;
                            }
                            vm.renderer.onClick(e);
                        }}
                        onDoubleClick={(e) => { if (panelDirtyRef.current) return; vm.renderer.onDblClick(e); }}
                        onContextMenu={(e) => { if (panelDirtyRef.current) return; setToolbarPanel("closed"); vm.renderer.onContextMenu(e); }}
                        onMouseMove={vm.renderer.onMouseMove}
                    />
                    {vm.isEmpty && (
                        <div className="graph-empty-hint">
                            Right-click → Add Node to start building the graph
                        </div>
                    )}
                    <div className={`graph-toolbar${isExpanded ? " expanded" : ""}${searchQuery ? " has-search" : ""}`}>
                        <div className="graph-toolbar-row">
                            <button
                                className={`graph-icon-btn${toolbarPanel === "settings" ? " active" : ""}`}
                                onClick={toggleSettings}
                                title="Force tuning"
                            >
                                <SettingsIcon width={14} height={14} />
                            </button>
                            <button
                                className={`graph-icon-btn${!vm.hasVisibilityFilter ? " disabled" : ""}`}
                                onClick={() => vm.resetVisibility()}
                                title="Reset view"
                                disabled={!vm.hasVisibilityFilter}
                            >
                                <RefreshIcon width={14} height={14} />
                            </button>
                            <button
                                className={`graph-icon-btn${!vm.hasVisibilityFilter ? " disabled" : ""}`}
                                onClick={handleExpandAll}
                                title="Expand all nodes"
                                disabled={!vm.hasVisibilityFilter}
                            >
                                <ExpandAllIcon width={14} height={14} />
                            </button>
                            <div className="graph-search-wrap">
                                <input
                                    ref={inputRef}
                                    className="graph-search-input"
                                    type="text"
                                    placeholder="Search nodes..."
                                    value={searchQuery}
                                    onChange={onSearchChange}
                                    onKeyDown={onSearchKeyDown}
                                    onFocus={onSearchFocus}
                                />
                                {searchQuery && (
                                    <span className="graph-search-clear" onClick={onSearchClear}>
                                        ×
                                    </span>
                                )}
                            </div>
                            {searchInfo && !isExpanded && (
                                <span className="graph-search-info">
                                    {searchInfo.visible} matched
                                </span>
                            )}
                        </div>
                        {isExpanded && (
                            <>
                                <div className="toolbar-tabs">
                                    <button
                                        className={`toolbar-tab${toolbarPanel === "settings" ? " active" : ""}`}
                                        onClick={() => setToolbarPanel("settings")}
                                    >
                                        Physics
                                    </button>
                                    <button
                                        className={`toolbar-tab${toolbarPanel === "expansion" ? " active" : ""}`}
                                        onClick={() => setToolbarPanel("expansion")}
                                    >
                                        Expansion
                                    </button>
                                    <button
                                        className={`toolbar-tab${toolbarPanel === "results" ? " active" : ""}`}
                                        onClick={() => setToolbarPanel("results")}
                                    >
                                        Results{resultCount > 0 ? ` (${resultCount})` : ""}
                                    </button>
                                </div>
                                {toolbarPanel === "settings" && <GraphTuningSliders vm={vm} />}
                                {toolbarPanel === "expansion" && <GraphExpansionSettings vm={vm} />}
                                {toolbarPanel === "results" && (
                                    <>
                                        {searchResults && searchResults.length > 0 ? (
                                            <GraphSearchResults
                                                results={searchResults}
                                                searchQuery={searchQuery}
                                                selectedIndex={selectedResultIndex}
                                                onSelect={onSelectResult}
                                            />
                                        ) : (
                                            <div className="search-no-results">
                                                {searchQuery ? "No results" : "Type to search"}
                                            </div>
                                        )}
                                        {searchInfo && (
                                            <div className="search-status-bar">
                                                <span>{searchInfo.visible} visible</span>
                                                {searchInfo.hidden > 0 && (
                                                    <span className="search-reveal" onClick={onRevealHidden}>
                                                        [+{searchInfo.hidden} hidden]
                                                    </span>
                                                )}
                                                <span className="search-reveal" onClick={() => vm.selectSearchResults()}>
                                                    [{selectedNodes.length > 0 ? "add to selection" : "select all"}]
                                                </span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                    {tooltip && (
                        <GraphTooltip node={tooltip.node} x={tooltip.x} y={tooltip.y} memberCount={tooltip.memberCount} />
                    )}
                    <GraphDetailPanel
                        nodes={selectedNodes.filter((n) => !n.isGroup)}
                        linkedNodes={linkedNodes}
                        onUpdateProps={(nodeId, props) => vm.updateNodeProps(nodeId, props)}
                        onBatchUpdateProps={(nodeIds, props) => vm.batchUpdateNodeProps(nodeIds, props)}
                        onRenameNode={(oldId, newId) => vm.renameNode(oldId, newId)}
                        onApplyLinks={(nodeId, rows, origIds) => vm.applyLinkedNodesUpdate(nodeId, rows, origIds)}
                        onApplyProperties={(nodeId, propsToSet, keysToRemove) => vm.applyPropertiesUpdate(nodeId, propsToSet, keysToRemove)}
                        onBatchApplyProperties={(nodeIds, propsToSet, keysToRemove) => vm.batchApplyPropertiesUpdate(nodeIds, propsToSet, keysToRemove)}
                        onPanelDirtyChange={onPanelDirtyChange}
                        onPanelExpandedChange={onPanelExpandedChange}
                        onHighlightSet={(ids) => vm.setHighlightSet(ids)}
                        onExternalHover={(id) => vm.setExternalHover(id)}
                        onExpandNode={(id) => vm.expandNode(id)}
                        containerRef={containerRef}
                        expandRequest={expandRequest}
                        collapseRequest={collapseRequest}
                    />
                    <GraphLegendPanel vm={vm} />
                </>
            )}
            {Boolean(model.editorFooterRefLast) &&
                createPortal(
                    <>
                        {statusHint && <span style={{ fontStyle: "italic", color: color.warning.text, marginRight: 12 }}>{statusHint}</span>}
                        <span>{vm.recordsCount}</span>
                    </>,
                    model.editorFooterRefLast,
                )}
        </GraphViewRoot>
    );
}

export { GraphView };
export type { GraphViewProps };
