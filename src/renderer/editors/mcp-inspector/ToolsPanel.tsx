import { useCallback, useRef, useState } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Button } from "../../components/basic/Button";
import { Splitter } from "../../components/layout/Splitter";
import { McpInspectorModel } from "./McpInspectorModel";
import { ToolArgForm } from "./ToolArgForm";
import { ToolResultView } from "./ToolResultView";

// ============================================================================
// Styles
// ============================================================================

const ToolsPanelRoot = styled.div({
    display: "flex",
    flex: "1 1 auto",
    overflow: "hidden",

    "& .tools-sidebar": {
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
    },

    "& .sidebar-header": {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        fontSize: 11,
        fontWeight: 600,
        color: color.text.light,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        borderBottom: `1px solid ${color.border.light}`,
        flexShrink: 0,
    },

    "& .sidebar-count": {
        fontSize: 11,
        fontWeight: 400,
        color: color.text.light,
        background: color.background.light,
        padding: "1px 6px",
        borderRadius: 8,
    },

    "& .sidebar-list": {
        flex: "1 1 auto",
        overflowY: "auto",
        overflowX: "hidden",
    },

    "& .sidebar-item": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        fontSize: 12,
        cursor: "pointer",
        color: color.text.light,
        borderBottom: `1px solid ${color.border.light}`,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        "&:hover": {
            background: color.background.light,
            color: color.text.default,
        },
    },

    "& .sidebar-item.active": {
        background: color.background.light,
        color: color.text.default,
        borderLeft: `2px solid ${color.border.active}`,
        paddingLeft: 10,
    },

    "& .tool-detail": {
        flex: "1 1 auto",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },

    // ── Top panel: tool header + args (scrollable) ──
    "& .tool-panel-top": {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },

    "& .tool-panel-top-header": {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 16px",
        fontSize: 14,
        fontWeight: 500,
        color: color.text.strong,
        background: color.background.dark,
        borderBottom: `1px solid ${color.border.light}`,
        flexShrink: 0,
    },

    "& .tool-description": {
        fontSize: 13,
        color: color.text.light,
        lineHeight: 1.5,
    },

    "& .tool-annotations": {
        display: "flex",
        gap: 4,
        flexShrink: 0,
    },

    "& .annotation-badge": {
        fontSize: 11,
        padding: "1px 5px",
        borderRadius: 3,
        background: color.background.light,
        border: `1px solid ${color.border.light}`,
        color: color.text.light,
    },

    "& .annotation-badge.destructive": {
        color: color.error.text,
        borderColor: color.error.text,
    },

    "& .tool-panel-top-body": {
        flex: "1 1 auto",
        overflow: "auto",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
    },

    "& .section-title": {
        fontSize: 11,
        fontWeight: 600,
        color: color.text.light,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        paddingBottom: 4,
        borderBottom: `1px solid ${color.border.light}`,
    },

    // ── Bottom panel: result ──
    "& .tool-panel-bottom": {
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },

    "& .tool-panel-bottom-header": {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 12px",
        fontSize: 11,
        fontWeight: 600,
        color: color.text.light,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        background: color.background.dark,
        borderBottom: `1px solid ${color.border.light}`,
        flexShrink: 0,
    },

    "& .tool-panel-bottom-header .result-duration": {
        fontSize: 11,
        fontWeight: 400,
        color: color.text.light,
        background: color.background.light,
        padding: "1px 6px",
        borderRadius: 2,
        textTransform: "none",
        letterSpacing: 0,
    },

    "& .tool-panel-bottom-header .result-error-badge": {
        fontSize: 11,
        fontWeight: 500,
        color: color.error.text,
        textTransform: "none",
        letterSpacing: 0,
    },

    "& .tool-panel-bottom-header .call-btn": {
        marginLeft: "auto",
        textTransform: "none",
        letterSpacing: 0,
        "& button": {
            background: color.background.selection,
            color: color.text.selection,
            border: `1px solid ${color.background.selection}`,
            borderRadius: 4,
            padding: "3px 8px",
            fontWeight: 500,
            "&:hover": {
                filter: "brightness(1.1)",
            },
            "&:disabled": {
                opacity: 0.6,
                filter: "none",
            },
        },
    },

    "& .tool-panel-bottom-body": {
        flex: "1 1 auto",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: "8px 12px 12px",
    },

    "& .empty-detail": {
        flex: "1 1 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: color.text.light,
        fontSize: 13,
    },

    "& .empty-result": {
        flex: "1 1 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: color.text.light,
        fontSize: 12,
    },
});

// ============================================================================
// Component
// ============================================================================

interface ToolsPanelProps {
    model: McpInspectorModel;
}

export function ToolsPanel({ model }: ToolsPanelProps) {
    const ts = model.toolsState.use();
    const [sidebarWidth, setSidebarWidth] = useState(200);
    const [resultHeight, setResultHeight] = useState<number | null>(null);
    const detailRef = useRef<HTMLDivElement>(null);

    const selectedTool = ts.tools.find((t) => t.name === ts.selectedToolName) || null;

    const handleCallTool = useCallback(() => {
        model.callTool();
    }, [model]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && e.ctrlKey) {
            model.callTool();
        }
    }, [model]);

    // Compute clamped result height (10%-90% of container)
    const getClampedHeight = useCallback((h: number) => {
        const container = detailRef.current;
        if (!container) return h;
        const total = container.clientHeight;
        const min = total * 0.1;
        const max = total * 0.9;
        return Math.max(min, Math.min(max, h));
    }, []);

    const handleResultHeightChange = useCallback((h: number) => {
        setResultHeight(getClampedHeight(h));
    }, [getClampedHeight]);

    const togglePanelHeight = useCallback((expandedRatio: number) => {
        const container = detailRef.current;
        if (!container) return;
        const total = container.clientHeight;
        const expanded = total * expandedRatio;
        const collapsed = total * (1 - expandedRatio);
        const current = resultHeight ?? total * 0.3;
        // Toggle: if close to expanded, collapse; otherwise expand
        const isExpanded = Math.abs(current - expanded) < total * 0.05;
        setResultHeight(isExpanded ? collapsed : expanded);
    }, [resultHeight]);

    const handleTopHeaderDblClick = useCallback(() => {
        // Top wants to be big → result should be small (30%) or toggle to big (70%)
        togglePanelHeight(0.3);
    }, [togglePanelHeight]);

    const handleBottomHeaderDblClick = useCallback(() => {
        // Bottom wants to be big → result should be 70% or toggle to small (30%)
        togglePanelHeight(0.7);
    }, [togglePanelHeight]);

    // Initialize result height to 30% of container on first render
    const getInitialResultHeight = useCallback(() => {
        if (resultHeight !== null) return resultHeight;
        const container = detailRef.current;
        if (!container) return 200;
        return container.clientHeight * 0.3;
    }, [resultHeight]);

    const currentResultHeight = resultHeight ?? getInitialResultHeight();
    const topFlex = resultHeight !== null
        ? `1 1 auto`
        : `7 1 0`;
    const bottomStyle = resultHeight !== null
        ? { height: currentResultHeight, flexShrink: 0, flexGrow: 0 }
        : { flex: "3 1 0", minHeight: 0 };

    return (
        <ToolsPanelRoot onKeyDown={handleKeyDown}>
            {/* Sidebar */}
            <div className="tools-sidebar" style={{ width: sidebarWidth }}>
                <div className="sidebar-header">
                    <span>Tools</span>
                    <span className="sidebar-count">{ts.tools.length}</span>
                </div>
                <div className="sidebar-list">
                    {ts.tools.map((tool) => (
                        <div
                            key={tool.name}
                            className={`sidebar-item${tool.name === ts.selectedToolName ? " active" : ""}`}
                            title={tool.name}
                            onClick={() => model.selectTool(tool.name)}
                        >
                            {tool.name}
                        </div>
                    ))}
                </div>
            </div>

            <Splitter
                type="vertical"
                initialWidth={sidebarWidth}
                onChangeWidth={setSidebarWidth}
                borderSized="right"
            />

            {/* Detail panel */}
            {selectedTool ? (
                <div className="tool-detail" ref={detailRef}>
                    {/* Top: tool name + args (scrollable) */}
                    <div className="tool-panel-top" style={{ flex: topFlex, overflow: "hidden", minHeight: 0 }}>
                        <div className="tool-panel-top-header" onDoubleClick={handleTopHeaderDblClick}>
                            <span>{selectedTool.name}</span>
                            {selectedTool.annotations && (
                                <div className="tool-annotations">
                                    {selectedTool.annotations.readOnlyHint && (
                                        <span className="annotation-badge">read-only</span>
                                    )}
                                    {selectedTool.annotations.destructiveHint && (
                                        <span className="annotation-badge destructive">destructive</span>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="tool-panel-top-body">
                            {selectedTool.description && (
                                <div className="tool-description">{selectedTool.description}</div>
                            )}
                            <div className="section-title">Arguments</div>
                            <ToolArgForm
                                schema={selectedTool.inputSchema}
                                args={ts.toolArgs}
                                onArgChange={model.setToolArg}
                                disabled={ts.toolCallLoading}
                            />
                        </div>
                    </div>

                    {/* Horizontal splitter */}
                    <Splitter
                        type="horizontal"
                        initialHeight={currentResultHeight}
                        onChangeHeight={handleResultHeightChange}
                        borderSized="top"
                    />

                    {/* Bottom: result */}
                    <div className="tool-panel-bottom" style={bottomStyle as any}>
                        <div className="tool-panel-bottom-header" onDoubleClick={handleBottomHeaderDblClick}>
                            <span>Result</span>
                            {ts.toolResult && (
                                <>
                                    <span className="result-duration">{ts.toolResult.durationMs}ms</span>
                                    {ts.toolResult.isError && <span className="result-error-badge">Error</span>}
                                </>
                            )}
                            <span className="call-btn">
                                <Button
                                    type="flat"
                                    size="small"
                                    onClick={handleCallTool}
                                    disabled={ts.toolCallLoading}
                                >
                                    {ts.toolCallLoading ? "Calling…" : "▶ Call Tool"}
                                </Button>
                            </span>
                        </div>
                        <div className="tool-panel-bottom-body">
                            {ts.toolResult ? (
                                <ToolResultView result={ts.toolResult} />
                            ) : (
                                <div className="empty-result">
                                    Click "Call Tool" to execute.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="empty-detail">
                    {ts.tools.length === 0
                        ? "No tools available on this server."
                        : "Select a tool from the sidebar."}
                </div>
            )}
        </ToolsPanelRoot>
    );
}
