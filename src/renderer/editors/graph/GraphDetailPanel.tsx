import styled from "@emotion/styled";
import { SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GraphNode, NodeShape, nodeLabel, isReservedPropertyKey } from "./types";
import AVGrid from "../../components/data-grid/AVGrid/AVGrid";
import type { CellFocus, Column } from "../../components/data-grid/AVGrid/avGridTypes";
import { detectColumnWidth } from "../../components/data-grid/column-width";
import color from "../../theme/color";
import { ChevronDownIcon, ChevronUpIcon } from "../../theme/icons";
import { ShapeIcon, LevelIcon } from "./GraphIcons";

// =============================================================================
// Constants
// =============================================================================

const SHAPES: NodeShape[] = ["circle", "square", "diamond", "triangle", "star", "hexagon"];
const LEVELS = [1, 2, 3, 4, 5];
const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 300;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 200;
const MAX_PERCENT = 0.9;

// =============================================================================
// Styled
// =============================================================================

const GraphDetailPanelRoot = styled.div({
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
    userSelect: "none",

    "& .panel-header": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        backgroundColor: color.background.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: 4,
        boxShadow: `0 2px 8px ${color.shadow.default}`,
        cursor: "pointer",
        minWidth: 120,
    },
    "& .panel-header.no-selection": {
        opacity: 0.5,
        pointerEvents: "none",
        cursor: "default",
    },
    "& .panel-header.locked": {
        cursor: "default",
    },
    "& .panel-title": {
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontWeight: 600,
        color: color.text.default,
    },
    "& .panel-chevron": {
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        color: color.text.light,
    },

    "& .panel-body": {
        display: "flex",
        flexDirection: "column",
        marginTop: 2,
        backgroundColor: color.background.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: 4,
        boxShadow: `0 2px 8px ${color.shadow.default}`,
        overflow: "hidden",
        position: "relative",
    },
    "& .panel-tabs": {
        display: "flex",
        borderBottom: `1px solid ${color.border.default}`,
    },
    "& .panel-tab": {
        flex: 1,
        padding: "4px 8px",
        fontSize: 11,
        border: "none",
        background: "none",
        cursor: "pointer",
        color: color.text.light,
        borderBottom: "2px solid transparent",
        "&:hover": {
            color: color.text.default,
        },
    },
    "& .panel-tab.active": {
        color: color.text.default,
        borderBottomColor: color.border.active,
    },
    "& .panel-tab.disabled": {
        opacity: 0.4,
        cursor: "default",
    },
    "& .panel-content": {
        flex: 1,
        overflow: "auto",
        padding: 8,
    },
    "& .panel-content.no-pad": {
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },

    // Info tab form
    "& .info-field": {
        display: "flex",
        flexDirection: "column",
        gap: 2,
        marginBottom: 8,
    },
    "& .info-field:last-child": {
        marginBottom: 0,
    },
    "& .info-label": {
        fontSize: 11,
        color: color.text.light,
    },
    "& .info-input": {
        width: "100%",
        padding: "3px 6px",
        fontSize: 12,
        border: `1px solid ${color.border.light}`,
        borderRadius: 3,
        backgroundColor: color.background.dark,
        color: color.text.default,
        outline: "none",
        boxSizing: "border-box",
        "&:focus": {
            borderColor: color.border.active,
        },
    },
    "& .info-input.error": {
        borderColor: color.error.border,
    },
    "& .info-error": {
        fontSize: 10,
        color: color.error.text,
        marginTop: 1,
    },
    // Inline icon selectors (level, shape)
    "& .info-icons": {
        display: "flex",
        alignItems: "center",
        gap: 2,
    },
    "& .info-icon-btn": {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        border: `1px solid transparent`,
        borderRadius: 3,
        background: "none",
        cursor: "pointer",
        color: color.text.light,
        padding: 0,
        "&:hover": {
            borderColor: color.border.default,
            color: color.text.default,
        },
    },
    "& .info-icon-btn.selected": {
        borderColor: color.border.active,
        color: color.text.default,
        backgroundColor: color.background.dark,
    },
    "& .info-icon-btn.mixed": {
        borderColor: "transparent",
        color: color.warning.text,
    },
    "& .multi-info": {
        fontSize: 11,
        color: color.warning.text,
        fontStyle: "italic",
        marginBottom: 8,
    },

    // Links tab
    "& .links-tab": {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
    },
    "& .links-grid, & .properties-grid": {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
    },
    "& .tab-action-row": {
        display: "flex",
        justifyContent: "flex-end",
        gap: 4,
        padding: "4px 6px",
        borderTop: `1px solid ${color.border.default}`,
        flexShrink: 0,
    },
    "& .tab-apply-btn": {
        padding: "2px 12px",
        fontSize: 11,
        cursor: "pointer",
        border: `1px solid ${color.border.active}`,
        borderRadius: 3,
        backgroundColor: color.border.active,
        color: color.background.default,
        "&:hover": {
            opacity: 0.9,
        },
        "&.disabled": {
            opacity: 0.4,
            cursor: "default",
            pointerEvents: "none",
        },
    },
    "& .tab-cancel-btn": {
        padding: "2px 12px",
        fontSize: 11,
        cursor: "pointer",
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        backgroundColor: "transparent",
        color: color.text.light,
        "&:hover": {
            borderColor: color.text.light,
        },
    },
    // Properties tab
    "& .properties-tab": {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
    },
    "& .data-cell.cell-error": {
        color: color.error.text,
    },
    "& .data-cell.cell-mixed": {
        color: color.warning.text,
    },
    "& .properties-status": {
        fontSize: 10,
        color: color.warning.text,
        padding: "2px 6px",
        borderTop: `1px solid ${color.border.default}`,
        flexShrink: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        userSelect: "text",
        cursor: "text",
    },

    // Resizer
    "& .panel-resizer": {
        position: "absolute",
        bottom: 0,
        left: 0,
        width: 12,
        height: 12,
        cursor: "sw-resize",
        opacity: 0.4,
        "&:hover": {
            opacity: 0.8,
        },
    },
});

// =============================================================================
// Props
// =============================================================================

interface GraphDetailPanelProps {
    nodes: GraphNode[];
    linkedNodes: GraphNode[];
    onUpdateProps: (nodeId: string, props: Partial<GraphNode>) => void;
    onBatchUpdateProps: (nodeIds: string[], props: Partial<GraphNode>) => void;
    onRenameNode: (oldId: string, newId: string) => boolean;
    onApplyLinks: (selectedNodeId: string, rows: Record<string, unknown>[], originalIds: Set<string>) => void;
    onApplyProperties: (nodeId: string, propsToSet: Record<string, string>, keysToRemove: string[]) => void;
    onBatchApplyProperties: (nodeIds: string[], propsToSet: Record<string, string>, keysToRemove: string[]) => void;
    onPanelDirtyChange?: (dirty: boolean) => void;
    onPanelExpandedChange?: (expanded: boolean) => void;
    onHighlightSet?: (ids: Set<string> | null) => void;
    onExternalHover?: (id: string) => void;
    onExpandNode?: (nodeId: string) => void;
    containerRef?: React.RefObject<HTMLElement | null>;
    /** Increment to request panel expansion (e.g. on double-click). */
    expandRequest?: number;
    /** Increment to request panel collapse (e.g. on canvas click). */
    collapseRequest?: number;
}

// =============================================================================
// Component
// =============================================================================

function GraphDetailPanel({
    nodes, linkedNodes, onUpdateProps, onBatchUpdateProps, onRenameNode, onApplyLinks,
    onApplyProperties, onBatchApplyProperties,
    onPanelDirtyChange, onPanelExpandedChange, onHighlightSet, onExternalHover, onExpandNode,
    containerRef, expandRequest, collapseRequest,
}: GraphDetailPanelProps) {
    const hasSelection = nodes.length > 0;
    const isMulti = nodes.length > 1;
    const singleNode = nodes.length === 1 ? nodes[0] : null;

    // Panel expand/collapse state
    const [expanded, setExpanded] = useState(false);
    const wasExpandedRef = useRef(true); // remember user preference
    const hadSelectionRef = useRef(false);
    const [activeTab, setActiveTab] = useState("info");
    const [linksDirty, setLinksDirty] = useState(false);
    const [propertiesDirty, setPropertiesDirty] = useState(false);
    const anyDirty = linksDirty || propertiesDirty;

    // Resize state
    const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
    const resizingRef = useRef(false);
    const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

    // Form state for text fields (commit on blur/Enter) — single selection only
    const [editId, setEditId] = useState("");
    const [editTitle, setEditTitle] = useState("");
    const [idError, setIdError] = useState("");

    // Track dirty state from LinksTab and PropertiesTab
    const handleLinksDirtyChange = useCallback((dirty: boolean) => {
        setLinksDirty(dirty);
        onPanelDirtyChange?.(dirty || propertiesDirty);
    }, [onPanelDirtyChange, propertiesDirty]);

    const handlePropertiesDirtyChange = useCallback((dirty: boolean) => {
        setPropertiesDirty(dirty);
        onPanelDirtyChange?.(dirty || linksDirty);
    }, [onPanelDirtyChange, linksDirty]);

    // Stable key for tracking selection identity changes
    const selectionKey = useMemo(() => nodes.map((n) => n.id).sort().join(","), [nodes]);

    // Sync form state when single node changes
    useEffect(() => {
        if (singleNode) {
            setEditId(singleNode.id);
            setEditTitle(singleNode.title || "");
            setIdError("");
        }
    }, [singleNode?.id, singleNode?.title]);

    // Force active tab to "info" if switching to multi and currently on "links"
    useEffect(() => {
        if (isMulti && activeTab === "links") {
            setActiveTab("info");
        }
    }, [isMulti]);

    // Handle expand/collapse transitions based on selection
    useEffect(() => {
        if (hasSelection) {
            if (!hadSelectionRef.current) {
                setExpanded(wasExpandedRef.current);
            }
            hadSelectionRef.current = true;
        } else {
            wasExpandedRef.current = false;
            setExpanded(false);
            hadSelectionRef.current = false;
        }
    }, [selectionKey]);
    // External expand request (e.g. double-click on node)
    useEffect(() => {
        if (expandRequest && hasSelection) {
            setExpanded(true);
            wasExpandedRef.current = true;
        }
    }, [expandRequest]);
    // External collapse request (e.g. canvas click)
    useEffect(() => {
        if (collapseRequest && expanded && !anyDirty) {
            setExpanded(false);
            wasExpandedRef.current = false;
        }
    }, [collapseRequest]);
    // Notify parent of expanded state changes
    useEffect(() => {
        onPanelExpandedChange?.(expanded);
    }, [expanded, onPanelExpandedChange]);
    const toggleExpanded = useCallback(() => {
        if (!hasSelection || anyDirty) return;
        setExpanded((prev) => {
            wasExpandedRef.current = !prev;
            return !prev;
        });
    }, [hasSelection, anyDirty]);

    // Links tab highlighting: dim non-linked nodes when Links tab is active (single selection only)
    const linksTabActive = expanded && activeTab === "links" && !!singleNode;
    useEffect(() => {
        if (linksTabActive) {
            onExpandNode?.(singleNode!.id);
            const ids = new Set([singleNode!.id, ...linkedNodes.map((n) => n.id)]);
            onHighlightSet?.(ids);
        } else {
            onHighlightSet?.(null);
            onExternalHover?.("");
        }
    }, [linksTabActive, singleNode?.id, linkedNodes]);
    // Cleanup on unmount
    useEffect(() => () => { onHighlightSet?.(null); onExternalHover?.(""); }, []);

    // ID commit on blur or Enter (single selection only)
    const commitId = useCallback(() => {
        if (!singleNode) return;
        const trimmed = editId.trim();
        if (trimmed === singleNode.id) {
            setIdError("");
            return;
        }
        if (!trimmed) {
            setEditId(singleNode.id);
            setIdError("");
            return;
        }
        const ok = onRenameNode(singleNode.id, trimmed);
        if (!ok) {
            setIdError("ID already exists");
        } else {
            setIdError("");
        }
    }, [singleNode, editId, onRenameNode]);

    // Title commit on blur or Enter (single selection only)
    const commitTitle = useCallback(() => {
        if (!singleNode) return;
        const value = editTitle.trim();
        if (value === (singleNode.title || "")) return;
        onUpdateProps(singleNode.id, { title: value || undefined });
    }, [singleNode, editTitle, onUpdateProps]);

    const handleKeyDown = useCallback((_commit: () => void) => (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLElement).blur();
        } else if (e.key === "Escape") {
            e.preventDefault();
            if (singleNode) {
                setEditId(singleNode.id);
                setEditTitle(singleNode.title || "");
                setIdError("");
            }
            (e.target as HTMLElement).blur();
        }
    }, [singleNode]);

    // Resizer handlers
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizingRef.current = true;
        resizeStartRef.current = { x: e.clientX, y: e.clientY, width: size.width, height: size.height };

        const handleMouseMove = (e: MouseEvent) => {
            if (!resizingRef.current) return;
            const dx = resizeStartRef.current.x - e.clientX;
            const dy = e.clientY - resizeStartRef.current.y;

            let newWidth = resizeStartRef.current.width + dx;
            let newHeight = resizeStartRef.current.height + dy;

            newWidth = Math.max(MIN_WIDTH, newWidth);
            newHeight = Math.max(MIN_HEIGHT, newHeight);

            const container = containerRef?.current;
            if (container) {
                const rect = container.getBoundingClientRect();
                newWidth = Math.min(newWidth, rect.width * MAX_PERCENT);
                newHeight = Math.min(newHeight, rect.height * MAX_PERCENT);
            }

            setSize({ width: newWidth, height: newHeight });
        };

        const handleMouseUp = () => {
            resizingRef.current = false;
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    }, [size, containerRef]);

    // Header text
    const headerText = isMulti
        ? `${nodes.length} nodes selected`
        : singleNode
            ? nodeLabel(singleNode)
            : "select node for edit";
    const headerClass = hasSelection
        ? `panel-header${anyDirty ? " locked" : ""}`
        : "panel-header no-selection";

    // Whether links tab is available (single selection only)
    const linksAvailable = !isMulti;

    return (
        <GraphDetailPanelRoot>
            <div className={headerClass} onClick={toggleExpanded}>
                <span className="panel-title" title={headerText}>{headerText}</span>
                {hasSelection && (
                    <span className="panel-chevron">
                        {expanded ? <ChevronUpIcon width={14} height={14} /> : <ChevronDownIcon width={14} height={14} />}
                    </span>
                )}
            </div>

            {expanded && hasSelection && (
                <div className="panel-body" style={{ width: size.width, height: size.height }}>
                    <div className="panel-tabs">
                        <button
                            className={`panel-tab ${activeTab === "info" ? "active" : ""}${anyDirty && activeTab !== "info" ? " disabled" : ""}`}
                            onClick={() => { if (!anyDirty) setActiveTab("info"); }}
                        >
                            Info
                        </button>
                        <button
                            className={`panel-tab ${activeTab === "properties" ? "active" : ""}${anyDirty && activeTab !== "properties" ? " disabled" : ""}`}
                            onClick={() => { if (!anyDirty) setActiveTab("properties"); }}
                        >
                            Properties
                        </button>
                        {linksAvailable && (
                            <button
                                className={`panel-tab ${activeTab === "links" ? "active" : ""}${anyDirty && activeTab !== "links" ? " disabled" : ""}`}
                                onClick={() => { if (!anyDirty) setActiveTab("links"); }}
                            >
                                Links
                            </button>
                        )}
                    </div>

                    <div className={`panel-content${activeTab !== "info" ? " no-pad" : ""}`}>
                        {activeTab === "info" && (
                            isMulti ? (
                                <MultiInfoTab
                                    nodes={nodes}
                                    onBatchUpdateProps={onBatchUpdateProps}
                                />
                            ) : singleNode ? (
                                <InfoTab
                                    node={singleNode}
                                    editId={editId}
                                    setEditId={setEditId}
                                    editTitle={editTitle}
                                    setEditTitle={setEditTitle}
                                    idError={idError}
                                    commitId={commitId}
                                    commitTitle={commitTitle}
                                    handleKeyDown={handleKeyDown}
                                    onUpdateProps={onUpdateProps}
                                />
                            ) : null
                        )}
                        {activeTab === "properties" && (
                            <PropertiesTab
                                nodes={nodes}
                                onApply={onApplyProperties}
                                onBatchApply={onBatchApplyProperties}
                                onDirtyChange={handlePropertiesDirtyChange}
                            />
                        )}
                        {activeTab === "links" && singleNode && (
                            <LinksTab
                                linkedNodes={linkedNodes}
                                selectedNodeId={singleNode.id}
                                onApply={onApplyLinks}
                                onDirtyChange={handleLinksDirtyChange}
                                onExternalHover={onExternalHover}
                            />
                        )}
                    </div>

                    {/* Resizer — bottom-left corner */}
                    <div
                        className="panel-resizer"
                        onMouseDown={handleResizeStart}
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <line x1="2" y1="10" x2="0" y2="12" stroke={color.text.light} strokeWidth="1" />
                            <line x1="6" y1="10" x2="0" y2="4" stroke={color.text.light} strokeWidth="1" />
                            <line x1="10" y1="10" x2="0" y2="0" stroke={color.text.light} strokeWidth="1" />
                        </svg>
                    </div>
                </div>
            )}
        </GraphDetailPanelRoot>
    );
}

// =============================================================================
// Links Tab
// =============================================================================

type LinkRow = Record<string, unknown> & { id: string; _rowKey: string };

interface LinksTabProps {
    linkedNodes: GraphNode[];
    selectedNodeId: string;
    onApply: (selectedNodeId: string, rows: Record<string, unknown>[], originalIds: Set<string>) => void;
    onDirtyChange: (dirty: boolean) => void;
    onExternalHover?: (id: string) => void;
}

const KNOWN_KEYS = new Set(["id", "title", "level", "shape"]);

/** charWidth scaled for the detail panel's 12px font (vs 14px default grid font) */
const LINKS_CHAR_WIDTH = 7;
const LINKS_COL_OPTS = { charWidth: LINKS_CHAR_WIDTH, padding: 16, minWidth: 50, maxWidth: 200 };

function makeColumns(rows: LinkRow[]): Column<LinkRow>[] {
    const cols: Column<LinkRow>[] = [
        { key: "id", name: "ID", width: detectColumnWidth(rows, "id", "ID", LINKS_COL_OPTS), resizible: true, isStatusColumn: true },
        { key: "title", name: "Title", width: detectColumnWidth(rows, "title", "Title", LINKS_COL_OPTS), resizible: true },
        { key: "level", name: "Level", width: 60, resizible: true,
          options: [1, 2, 3, 4, 5] },
        { key: "shape", name: "Shape", width: 70, resizible: true,
          options: ["circle", "square", "diamond", "triangle", "star", "hexagon"] },
    ];

    const customKeys = new Set<string>();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (key !== "_rowKey" && !KNOWN_KEYS.has(key) && !key.startsWith("_$")) {
                customKeys.add(key);
            }
        }
    }
    for (const key of [...customKeys].sort()) {
        cols.push({
            key,
            name: key,
            width: detectColumnWidth(rows, key, key, LINKS_COL_OPTS),
            resizible: true,
        });
    }

    return cols;
}

function LinksTab({ linkedNodes, selectedNodeId, onApply, onDirtyChange, onExternalHover }: LinksTabProps) {
    const [rows, setRows] = useState<LinkRow[]>([]);
    const [columns, setColumns] = useState<Column<LinkRow>[]>([]);
    const [dirty, setDirty] = useState(false);
    const [focus, setFocus] = useState<CellFocus<LinkRow> | undefined>();
    const originalIdsRef = useRef<Set<string>>(new Set());
    const rowCounterRef = useRef(0);

    // Initialize rows and columns from linkedNodes prop
    useEffect(() => {
        const mapped = linkedNodes.map((n) => ({
            ...n,
            _rowKey: `link-${++rowCounterRef.current}`,
        }));
        setRows(mapped);
        setColumns(makeColumns(mapped));
        setDirty(false);
        onDirtyChange(false);
        originalIdsRef.current = new Set(linkedNodes.map((n) => n.id));
    }, [linkedNodes]);

    // External hover: highlight the node corresponding to the focused grid row
    useEffect(() => {
        if (focus?.rowKey) {
            const row = rows.find((r) => r._rowKey === focus.rowKey);
            onExternalHover?.(row?.id || "");
        } else {
            onExternalHover?.("");
        }
    }, [focus?.rowKey]);
    const markDirty = useCallback(() => {
        setDirty(true);
        onDirtyChange(true);
    }, [onDirtyChange]);

    const editRow = useCallback((columnKey: string, rowKey: string, value: any) => {
        // Validate level and shape
        if (columnKey === "level") {
            const num = Number(value);
            value = (num >= 1 && num <= 5) ? num : 5;
        }
        if (columnKey === "shape") {
            const shapes = ["circle", "square", "diamond", "triangle", "star", "hexagon"];
            if (!shapes.includes(value)) value = "circle";
        }

        setRows((prev) => prev.map((r) =>
            r._rowKey === rowKey ? { ...r, [columnKey]: value } : r
        ));
        markDirty();
    }, [markDirty]);

    const onAddRows = useCallback((count: number, insertIndex?: number) => {
        const newRows: LinkRow[] = Array.from({ length: count }, () => ({
            id: "",
            _rowKey: `link-${++rowCounterRef.current}`,
        }));
        setRows((prev) => {
            if (insertIndex !== undefined) {
                const copy = [...prev];
                copy.splice(insertIndex, 0, ...newRows);
                return copy;
            }
            return [...prev, ...newRows];
        });
        markDirty();
        return newRows;
    }, [markDirty]);

    const onDeleteRows = useCallback((rowKeys: string[]) => {
        const keySet = new Set(rowKeys);
        setRows((prev) => prev.filter((r) => !keySet.has(r._rowKey)));
        markDirty();
    }, [markDirty]);

    const getRowKey = useCallback((r: LinkRow) => r._rowKey, []);

    const handleApply = useCallback(() => {
        // Strip _rowKey before sending to ViewModel
        const cleanRows = rows.map((r) => {
            const { _rowKey, ...rest } = r;
            return rest;
        });
        onApply(selectedNodeId, cleanRows, originalIdsRef.current);
    }, [rows, selectedNodeId, onApply]);

    const handleCancel = useCallback(() => {
        // Reset to original linkedNodes
        const mapped = linkedNodes.map((n) => ({
            ...n,
            _rowKey: `link-${++rowCounterRef.current}`,
        }));
        setRows(mapped);
        setDirty(false);
        onDirtyChange(false);
        setColumns(makeColumns(mapped));
    }, [linkedNodes, onDirtyChange]);

    return (
        <div className="links-tab">
            <div className="links-grid">
                <AVGrid
                    columns={columns}
                    rows={rows}
                    getRowKey={getRowKey}
                    setColumns={setColumns}
                    focus={focus}
                    setFocus={setFocus as (value: SetStateAction<CellFocus<LinkRow> | undefined>) => void}
                    editRow={editRow}
                    onAddRows={onAddRows}
                    onDeleteRows={onDeleteRows}
                    entity="link"
                    disableFiltering
                    disableSorting
                    rowHeight={24}
                />
            </div>
            {dirty && (
                <div className="tab-action-row">
                    <button className="tab-cancel-btn" onClick={handleCancel}>
                        Cancel
                    </button>
                    <button className="tab-apply-btn" onClick={handleApply}>
                        Apply
                    </button>
                </div>
            )}
        </div>
    );
}

// =============================================================================
// Properties Tab
// =============================================================================

type PropertyRow = { _rowKey: string; key: string; value: string; _isChanged?: boolean };

interface PropertiesTabProps {
    nodes: GraphNode[];
    onApply: (nodeId: string, propsToSet: Record<string, string>, keysToRemove: string[]) => void;
    onBatchApply: (nodeIds: string[], propsToSet: Record<string, string>, keysToRemove: string[]) => void;
    onDirtyChange: (dirty: boolean) => void;
}

/** Extract custom properties from a single node. */
function extractCustomProperties(node: GraphNode): { key: string; value: string }[] {
    const rows: { key: string; value: string }[] = [];
    for (const [key, value] of Object.entries(node)) {
        if (isReservedPropertyKey(key)) continue;
        rows.push({ key, value: value == null ? "" : String(value) });
    }
    return rows;
}

/** Build merged properties from multiple nodes.
 *  Returns rows with value set when all nodes agree, empty when values differ. */
function extractMultiProperties(nodes: GraphNode[]): { key: string; value: string; allSame: boolean; uniqueValues: string[] }[] {
    // Collect all custom keys across all nodes
    const keySet = new Set<string>();
    for (const node of nodes) {
        for (const key of Object.keys(node)) {
            if (!isReservedPropertyKey(key)) keySet.add(key);
        }
    }

    const result: { key: string; value: string; allSame: boolean; uniqueValues: string[] }[] = [];
    for (const key of [...keySet].sort()) {
        const values: string[] = [];
        for (const node of nodes) {
            const v = (node as unknown as Record<string, unknown>)[key];
            if (v !== undefined && v !== null) {
                values.push(String(v));
            }
        }
        const uniqueValues = [...new Set(values)];
        const allSame = uniqueValues.length === 1 && values.length === nodes.length;
        result.push({
            key,
            value: allSame ? uniqueValues[0] : "",
            allSame,
            uniqueValues,
        });
    }
    return result;
}

const PROPERTY_COLUMNS: Column<PropertyRow>[] = [
    { key: "key", name: "Name", width: 120, resizible: true },
    { key: "value", name: "Value", width: 200, resizible: true },
];

function PropertiesTab({ nodes, onApply, onBatchApply, onDirtyChange }: PropertiesTabProps) {
    const isMulti = nodes.length > 1;
    const singleNode = nodes.length === 1 ? nodes[0] : null;
    const selectionKey = useMemo(() => nodes.map((n) => n.id).sort().join(","), [nodes]);

    const [rows, setRows] = useState<PropertyRow[]>([]);
    const [columns, setColumns] = useState<Column<PropertyRow>[]>(PROPERTY_COLUMNS);
    const [dirty, setDirty] = useState(false);
    const [focus, setFocus] = useState<CellFocus<PropertyRow> | undefined>();
    const [statusMessage, setStatusMessage] = useState("");
    const originalKeysRef = useRef<Set<string>>(new Set());
    const rowCounterRef = useRef(0);
    /** For multi-selection: stores value info per key for status messages. */
    const multiInfoRef = useRef<Map<string, { allSame: boolean; uniqueValues: string[] }>>(new Map());

    // Initialize from node(s) props
    useEffect(() => {
        rowCounterRef.current = 0;
        if (isMulti) {
            const merged = extractMultiProperties(nodes);
            multiInfoRef.current = new Map(merged.map((r) => [r.key, { allSame: r.allSame, uniqueValues: r.uniqueValues }]));
            const mapped: PropertyRow[] = merged.map((r) => ({
                _rowKey: `prop-${++rowCounterRef.current}`,
                key: r.key,
                value: r.value,
                _isChanged: false,
            }));
            setRows(mapped);
            originalKeysRef.current = new Set(merged.map((r) => r.key));
        } else if (singleNode) {
            const extracted = extractCustomProperties(singleNode);
            multiInfoRef.current = new Map();
            const mapped: PropertyRow[] = extracted.map((r) => ({
                _rowKey: `prop-${++rowCounterRef.current}`,
                key: r.key,
                value: r.value,
                _isChanged: false,
            }));
            setRows(mapped);
            originalKeysRef.current = new Set(extracted.map((r) => r.key));
        }
        setDirty(false);
        onDirtyChange(false);
        setStatusMessage("");
    }, [selectionKey, nodes]);

    // Update status message when focus changes
    useEffect(() => {
        if (!isMulti || !focus?.rowKey) {
            setStatusMessage("");
            return;
        }
        const row = rows.find((r) => r._rowKey === focus.rowKey);
        if (!row || !row.key) {
            setStatusMessage("");
            return;
        }
        const info = multiInfoRef.current.get(row.key);
        if (!info) {
            setStatusMessage("");
        } else if (info.allSame) {
            setStatusMessage("All nodes have the same value");
        } else if (info.uniqueValues.length === 0) {
            setStatusMessage("No nodes have this property");
        } else {
            const shown = info.uniqueValues.slice(0, 2).map((v) => `"${v}"`).join(", ");
            const suffix = info.uniqueValues.length > 2 ? ", ..." : "";
            setStatusMessage(`Values: ${shown}${suffix}`);
        }
    }, [focus?.rowKey, isMulti, rows]);

    // Check for reserved keys in rows
    const hasInvalidKeys = useMemo(() =>
        rows.some((r) => r.key && isReservedPropertyKey(r.key)),
    [rows]);

    const markDirty = useCallback(() => {
        setDirty(true);
        onDirtyChange(true);
    }, [onDirtyChange]);

    const editRow = useCallback((columnKey: string, rowKey: string, value: any) => {
        setRows((prev) => prev.map((r) =>
            r._rowKey === rowKey ? { ...r, [columnKey]: String(value ?? ""), _isChanged: true } : r
        ));
        markDirty();
    }, [markDirty]);

    const onAddRows = useCallback((count: number, insertIndex?: number) => {
        const newRows: PropertyRow[] = Array.from({ length: count }, () => ({
            _rowKey: `prop-${++rowCounterRef.current}`,
            key: "",
            value: "",
            _isChanged: true,
        }));
        setRows((prev) => {
            if (insertIndex !== undefined) {
                const copy = [...prev];
                copy.splice(insertIndex, 0, ...newRows);
                return copy;
            }
            return [...prev, ...newRows];
        });
        markDirty();
        return newRows;
    }, [markDirty]);

    const onDeleteRows = useCallback((rowKeys: string[]) => {
        const keySet = new Set(rowKeys);
        setRows((prev) => prev.filter((r) => !keySet.has(r._rowKey)));
        markDirty();
    }, [markDirty]);

    const getRowKey = useCallback((r: PropertyRow) => r._rowKey, []);

    const handleApply = useCallback(() => {
        if (isMulti) {
            // Only apply changed rows
            const propsToSet: Record<string, string> = {};
            for (const row of rows) {
                if (!row._isChanged) continue;
                const k = row.key.trim();
                if (!k || isReservedPropertyKey(k)) continue;
                propsToSet[k] = row.value;
            }
            // Keys that were originally present but are no longer in rows (deleted rows)
            const currentKeys = new Set(rows.map((r) => r.key.trim()).filter(Boolean));
            const keysToRemove = [...originalKeysRef.current].filter((k) => !currentKeys.has(k));

            const nodeIds = nodes.map((n) => n.id);
            onBatchApply(nodeIds, propsToSet, keysToRemove);
        } else if (singleNode) {
            // For single node: also only apply changed rows
            const propsToSet: Record<string, string> = {};
            for (const row of rows) {
                if (!row._isChanged) continue;
                const k = row.key.trim();
                if (!k || isReservedPropertyKey(k)) continue;
                propsToSet[k] = row.value;
            }
            const currentKeys = new Set(rows.map((r) => r.key.trim()).filter(Boolean));
            const keysToRemove = [...originalKeysRef.current].filter((k) => !currentKeys.has(k));

            onApply(singleNode.id, propsToSet, keysToRemove);
        }
    }, [rows, nodes, singleNode, isMulti, onApply, onBatchApply]);

    const handleCancel = useCallback(() => {
        rowCounterRef.current = 0;
        if (isMulti) {
            const merged = extractMultiProperties(nodes);
            multiInfoRef.current = new Map(merged.map((r) => [r.key, { allSame: r.allSame, uniqueValues: r.uniqueValues }]));
            const mapped: PropertyRow[] = merged.map((r) => ({
                _rowKey: `prop-${++rowCounterRef.current}`,
                key: r.key,
                value: r.value,
                _isChanged: false,
            }));
            setRows(mapped);
        } else if (singleNode) {
            const extracted = extractCustomProperties(singleNode);
            const mapped: PropertyRow[] = extracted.map((r) => ({
                _rowKey: `prop-${++rowCounterRef.current}`,
                key: r.key,
                value: r.value,
                _isChanged: false,
            }));
            setRows(mapped);
        }
        setDirty(false);
        onDirtyChange(false);
        setStatusMessage("");
    }, [nodes, singleNode, isMulti, onDirtyChange]);

    // Highlight reserved keys with error class; mixed values with warning class
    const cellClass = useCallback((row: PropertyRow, col: Column<PropertyRow>) => {
        if (col.key === "key" && row.key && isReservedPropertyKey(row.key)) {
            return "cell-error";
        }
        if (col.key === "key" && isMulti && row.key) {
            const info = multiInfoRef.current.get(row.key);
            if (info && !info.allSame && !row._isChanged) {
                return "cell-mixed";
            }
        }
        return "";
    }, [isMulti]);

    return (
        <div className="properties-tab">
            <div className="properties-grid">
                <AVGrid
                    columns={columns}
                    rows={rows}
                    getRowKey={getRowKey}
                    setColumns={setColumns}
                    focus={focus}
                    setFocus={setFocus as (value: SetStateAction<CellFocus<PropertyRow> | undefined>) => void}
                    editRow={editRow}
                    onAddRows={onAddRows}
                    onDeleteRows={onDeleteRows}
                    onCellClass={cellClass}
                    entity="property"
                    disableFiltering
                    disableSorting
                    rowHeight={24}
                />
            </div>
            {statusMessage && (
                <div className="properties-status">{statusMessage}</div>
            )}
            {dirty && (
                <div className="tab-action-row">
                    <button className="tab-cancel-btn" onClick={handleCancel}>
                        Cancel
                    </button>
                    <button
                        className={`tab-apply-btn${hasInvalidKeys ? " disabled" : ""}`}
                        onClick={handleApply}
                    >
                        Apply
                    </button>
                </div>
            )}
        </div>
    );
}

// Shape & Level Icons — imported from shared module
// (see GraphIcons.tsx for ShapeIcon and LevelIcon)

// =============================================================================
// Multi-Selection Info Tab
// =============================================================================

interface MultiInfoTabProps {
    nodes: GraphNode[];
    onBatchUpdateProps: (nodeIds: string[], props: Partial<GraphNode>) => void;
}

function MultiInfoTab({ nodes, onBatchUpdateProps }: MultiInfoTabProps) {
    const nodeIds = useMemo(() => nodes.map((n) => n.id), [nodes]);

    // Compute common level/shape across all selected nodes
    const commonLevel = useMemo(() => {
        const levels = new Set(nodes.map((n) => n.level ?? 5));
        return levels.size === 1 ? [...levels][0] : null;
    }, [nodes]);

    const presentLevels = useMemo(() =>
        new Set(nodes.map((n) => n.level ?? 5)),
    [nodes]);

    const commonShape = useMemo(() => {
        const shapes = new Set(nodes.map((n) => n.shape ?? "circle"));
        return shapes.size === 1 ? [...shapes][0] : null;
    }, [nodes]);

    const presentShapes = useMemo(() =>
        new Set(nodes.map((n) => n.shape ?? "circle")),
    [nodes]);

    return (
        <>
            <div className="multi-info">
                Batch edit level and shape for {nodes.length} selected nodes
            </div>

            <div className="info-field">
                <label className="info-label">Level</label>
                <div className="info-icons">
                    {LEVELS.map((lvl) => {
                        const isSelected = commonLevel === lvl;
                        const isMixed = !isSelected && presentLevels.has(lvl);
                        return (
                            <button
                                key={lvl}
                                className={`info-icon-btn${isSelected ? " selected" : ""}${isMixed ? " mixed" : ""}`}
                                onClick={() => onBatchUpdateProps(nodeIds, { level: lvl })}
                                title={`Level ${lvl}`}
                            >
                                <LevelIcon level={lvl} />
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="info-field">
                <label className="info-label">Shape</label>
                <div className="info-icons">
                    {SHAPES.map((shape) => {
                        const isSelected = commonShape === shape;
                        const isMixed = !isSelected && presentShapes.has(shape);
                        return (
                            <button
                                key={shape}
                                className={`info-icon-btn${isSelected ? " selected" : ""}${isMixed ? " mixed" : ""}`}
                                onClick={() => onBatchUpdateProps(nodeIds, { shape: shape === "circle" ? undefined : shape })}
                                title={shape}
                            >
                                <ShapeIcon shape={shape} />
                            </button>
                        );
                    })}
                </div>
            </div>
        </>
    );
}

// =============================================================================
// Info Tab (single selection)
// =============================================================================

interface InfoTabProps {
    node: GraphNode;
    editId: string;
    setEditId: (v: string) => void;
    editTitle: string;
    setEditTitle: (v: string) => void;
    idError: string;
    commitId: () => void;
    commitTitle: () => void;
    handleKeyDown: (commit: () => void) => (e: React.KeyboardEvent) => void;
    onUpdateProps: (nodeId: string, props: Partial<GraphNode>) => void;
}

function InfoTab({
    node, editId, setEditId, editTitle, setEditTitle,
    idError, commitId, commitTitle, handleKeyDown, onUpdateProps,
}: InfoTabProps) {
    return (
        <>
            <div className="info-field">
                <label className="info-label">ID</label>
                <input
                    className={`info-input ${idError ? "error" : ""}`}
                    value={editId}
                    onChange={(e) => { setEditId(e.target.value); }}
                    onBlur={commitId}
                    onKeyDown={handleKeyDown(commitId)}
                />
                {idError && <span className="info-error">{idError}</span>}
            </div>

            <div className="info-field">
                <label className="info-label">Title</label>
                <input
                    className="info-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={handleKeyDown(commitTitle)}
                    placeholder={node.id}
                />
            </div>

            <div className="info-field">
                <label className="info-label">Level</label>
                <div className="info-icons">
                    {LEVELS.map((lvl) => (
                        <button
                            key={lvl}
                            className={`info-icon-btn ${(node.level ?? 5) === lvl ? "selected" : ""}`}
                            onClick={() => onUpdateProps(node.id, { level: lvl })}
                            title={`Level ${lvl}`}
                        >
                            <LevelIcon level={lvl} />
                        </button>
                    ))}
                </div>
            </div>

            <div className="info-field">
                <label className="info-label">Shape</label>
                <div className="info-icons">
                    {SHAPES.map((shape) => (
                        <button
                            key={shape}
                            className={`info-icon-btn ${(node.shape ?? "circle") === shape ? "selected" : ""}`}
                            onClick={() => onUpdateProps(node.id, { shape: shape === "circle" ? undefined : shape })}
                            title={shape}
                        >
                            <ShapeIcon shape={shape} />
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}

export { GraphDetailPanel };
