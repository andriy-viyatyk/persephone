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
    "& .cell-error": {
        color: color.error.text,
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
    node: GraphNode | null;
    linkedNodes: GraphNode[];
    onUpdateProps: (nodeId: string, props: Partial<GraphNode>) => void;
    onRenameNode: (oldId: string, newId: string) => boolean;
    onApplyLinks: (selectedNodeId: string, rows: Record<string, unknown>[], originalIds: Set<string>) => void;
    onApplyProperties: (nodeId: string, propsToSet: Record<string, string>, keysToRemove: string[]) => void;
    onPanelDirtyChange?: (dirty: boolean) => void;
    onHighlightSet?: (ids: Set<string> | null) => void;
    onExternalHover?: (id: string) => void;
    onExpandNode?: (nodeId: string) => void;
    containerRef?: React.RefObject<HTMLElement | null>;
    /** Increment to request panel expansion (e.g. on double-click). */
    expandRequest?: number;
}

// =============================================================================
// Component
// =============================================================================

function GraphDetailPanel({
    node, linkedNodes, onUpdateProps, onRenameNode, onApplyLinks, onApplyProperties,
    onPanelDirtyChange, onHighlightSet, onExternalHover, onExpandNode, containerRef, expandRequest,
}: GraphDetailPanelProps) {
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

    // Form state for text fields (commit on blur/Enter)
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

    // Sync form state when node changes
    useEffect(() => {
        if (node) {
            setEditId(node.id);
            setEditTitle(node.title || "");
            setIdError("");
        }
    }, [node?.id, node?.title]);

    // Handle expand/collapse transitions based on selection
    useEffect(() => {
        if (node) {
            if (!hadSelectionRef.current) {
                // First selection or re-selection after deselection: restore wasExpanded
                setExpanded(wasExpandedRef.current);
            }
            hadSelectionRef.current = true;
        } else {
            // Lost selection: collapse and reset remembered state
            wasExpandedRef.current = false;
            setExpanded(false);
            hadSelectionRef.current = false;
        }
    }, [node?.id]);
    // External expand request (e.g. double-click on node)
    useEffect(() => {
        if (expandRequest && node) {
            setExpanded(true);
            wasExpandedRef.current = true;
        }
    }, [expandRequest]);
    const toggleExpanded = useCallback(() => {
        if (!node || anyDirty) return; // Block collapse when dirty
        setExpanded((prev) => {
            wasExpandedRef.current = !prev;
            return !prev;
        });
    }, [node, anyDirty]);

    // Links tab highlighting: dim non-linked nodes when Links tab is active
    const linksTabActive = expanded && activeTab === "links" && !!node;
    useEffect(() => {
        if (linksTabActive) {
            onExpandNode?.(node!.id);
            const ids = new Set([node!.id, ...linkedNodes.map((n) => n.id)]);
            onHighlightSet?.(ids);
        } else {
            onHighlightSet?.(null);
            onExternalHover?.("");
        }
    }, [linksTabActive, node?.id, linkedNodes]);
    // Cleanup on unmount
    useEffect(() => () => { onHighlightSet?.(null); onExternalHover?.(""); }, []);

    // ID commit on blur or Enter
    const commitId = useCallback(() => {
        if (!node) return;
        const trimmed = editId.trim();
        if (trimmed === node.id) {
            setIdError("");
            return;
        }
        if (!trimmed) {
            setEditId(node.id);
            setIdError("");
            return;
        }
        const ok = onRenameNode(node.id, trimmed);
        if (!ok) {
            setIdError("ID already exists");
        } else {
            setIdError("");
        }
    }, [node, editId, onRenameNode]);

    // Title commit on blur or Enter
    const commitTitle = useCallback(() => {
        if (!node) return;
        const value = editTitle.trim();
        if (value === (node.title || "")) return;
        onUpdateProps(node.id, { title: value || undefined });
    }, [node, editTitle, onUpdateProps]);

    const handleKeyDown = useCallback((_commit: () => void) => (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLElement).blur();
        } else if (e.key === "Escape") {
            e.preventDefault();
            // Revert and blur
            if (node) {
                setEditId(node.id);
                setEditTitle(node.title || "");
                setIdError("");
            }
            (e.target as HTMLElement).blur();
        }
    }, [node]);

    // Resizer handlers
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizingRef.current = true;
        resizeStartRef.current = { x: e.clientX, y: e.clientY, width: size.width, height: size.height };

        const handleMouseMove = (e: MouseEvent) => {
            if (!resizingRef.current) return;
            const dx = resizeStartRef.current.x - e.clientX; // Left drag increases width
            const dy = e.clientY - resizeStartRef.current.y; // Down drag increases height

            let newWidth = resizeStartRef.current.width + dx;
            let newHeight = resizeStartRef.current.height + dy;

            // Clamp to min
            newWidth = Math.max(MIN_WIDTH, newWidth);
            newHeight = Math.max(MIN_HEIGHT, newHeight);

            // Clamp to max (90% of container)
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
    const headerText = node ? nodeLabel(node) : "select node for edit";
    const headerClass = node
        ? `panel-header${anyDirty ? " locked" : ""}`
        : "panel-header no-selection";

    return (
        <GraphDetailPanelRoot>
            <div className={headerClass} onClick={toggleExpanded}>
                <span className="panel-title" title={headerText}>{headerText}</span>
                {node && (
                    <span className="panel-chevron">
                        {expanded ? <ChevronUpIcon width={14} height={14} /> : <ChevronDownIcon width={14} height={14} />}
                    </span>
                )}
            </div>

            {expanded && node && (
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
                        <button
                            className={`panel-tab ${activeTab === "links" ? "active" : ""}${anyDirty && activeTab !== "links" ? " disabled" : ""}`}
                            onClick={() => { if (!anyDirty) setActiveTab("links"); }}
                        >
                            Links
                        </button>
                    </div>

                    <div className={`panel-content${activeTab !== "info" ? " no-pad" : ""}`}>
                        {activeTab === "info" && (
                            <InfoTab
                                node={node}
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
                        )}
                        {activeTab === "properties" && (
                            <PropertiesTab
                                node={node}
                                onApply={onApplyProperties}
                                onDirtyChange={handlePropertiesDirtyChange}
                            />
                        )}
                        {activeTab === "links" && (
                            <LinksTab
                                linkedNodes={linkedNodes}
                                selectedNodeId={node.id}
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

type PropertyRow = { _rowKey: string; key: string; value: string };

interface PropertiesTabProps {
    node: GraphNode;
    onApply: (nodeId: string, propsToSet: Record<string, string>, keysToRemove: string[]) => void;
    onDirtyChange: (dirty: boolean) => void;
}

function extractCustomProperties(node: GraphNode): PropertyRow[] {
    const rows: PropertyRow[] = [];
    let counter = 0;
    for (const [key, value] of Object.entries(node)) {
        if (isReservedPropertyKey(key)) continue;
        rows.push({
            _rowKey: `prop-${++counter}`,
            key,
            value: value == null ? "" : String(value),
        });
    }
    return rows;
}

const PROPERTY_COLUMNS: Column<PropertyRow>[] = [
    { key: "key", name: "Name", width: 120, resizible: true },
    { key: "value", name: "Value", width: 200, resizible: true },
];

function PropertiesTab({ node, onApply, onDirtyChange }: PropertiesTabProps) {
    const [rows, setRows] = useState<PropertyRow[]>([]);
    const [columns, setColumns] = useState<Column<PropertyRow>[]>(PROPERTY_COLUMNS);
    const [dirty, setDirty] = useState(false);
    const [focus, setFocus] = useState<CellFocus<PropertyRow> | undefined>();
    const originalKeysRef = useRef<Set<string>>(new Set());
    const rowCounterRef = useRef(0);

    // Initialize from node props
    useEffect(() => {
        const extracted = extractCustomProperties(node);
        // Re-number row keys using our counter
        rowCounterRef.current = 0;
        const mapped = extracted.map((r) => ({
            ...r,
            _rowKey: `prop-${++rowCounterRef.current}`,
        }));
        setRows(mapped);
        setDirty(false);
        onDirtyChange(false);
        originalKeysRef.current = new Set(extracted.map((r) => r.key));
    }, [node.id, node]);

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
            r._rowKey === rowKey ? { ...r, [columnKey]: String(value ?? "") } : r
        ));
        markDirty();
    }, [markDirty]);

    const onAddRows = useCallback((count: number, insertIndex?: number) => {
        const newRows: PropertyRow[] = Array.from({ length: count }, () => ({
            _rowKey: `prop-${++rowCounterRef.current}`,
            key: "",
            value: "",
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
        const propsToSet: Record<string, string> = {};
        for (const row of rows) {
            const k = row.key.trim();
            if (!k || isReservedPropertyKey(k)) continue; // skip empty and reserved
            propsToSet[k] = row.value; // last-wins for duplicates
        }

        // Keys that were originally present but are no longer in rows
        const currentKeys = new Set(rows.map((r) => r.key.trim()).filter(Boolean));
        const keysToRemove = [...originalKeysRef.current].filter((k) => !currentKeys.has(k));

        onApply(node.id, propsToSet, keysToRemove);
    }, [rows, node.id, onApply]);

    const handleCancel = useCallback(() => {
        const extracted = extractCustomProperties(node);
        rowCounterRef.current = 0;
        const mapped = extracted.map((r) => ({
            ...r,
            _rowKey: `prop-${++rowCounterRef.current}`,
        }));
        setRows(mapped);
        setDirty(false);
        onDirtyChange(false);
    }, [node, onDirtyChange]);

    // Highlight reserved keys with error class
    const cellClass = useCallback((row: PropertyRow, col: Column<PropertyRow>) => {
        if (col.key === "key" && row.key && isReservedPropertyKey(row.key)) {
            return "cell-error";
        }
        return "";
    }, []);

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
// Info Tab
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
