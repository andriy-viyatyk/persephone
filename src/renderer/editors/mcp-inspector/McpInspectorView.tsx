import { useCallback, useEffect } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { Button } from "../../components/basic/Button";
import { PageToolbar } from "../base";
import { IPageState, PageType } from "../../../shared/types";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import { McpInspectorModel, McpInspectorPageState, getDefaultMcpInspectorPageState } from "./McpInspectorModel";
import { mcpConnectionStore } from "./McpConnectionStore";
import { ToolsPanel } from "./ToolsPanel";
import { ResourcesPanel } from "./ResourcesPanel";
import { PromptsPanel } from "./PromptsPanel";
import { MarkdownBlock } from "../markdown/MarkdownBlock";

// ============================================================================
// Styles
// ============================================================================

const McpInspectorViewRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    outline: "none",
    overflow: "hidden",

    "& .connection-bar": {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        flex: "1 1 auto",
    },

    "& .saved-select": {
        appearance: "none" as const,
        background: color.background.light,
        color: color.text.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        padding: "4px 8px",
        fontSize: 12,
        cursor: "pointer",
        maxWidth: 160,
        "&:focus": {
            outline: "none",
            borderColor: color.border.active,
        },
    },

    "& .bar-separator": {
        width: 1,
        height: 18,
        background: color.border.default,
        flexShrink: 0,
    },

    "& .transport-select": {
        appearance: "none" as const,
        background: color.background.default,
        color: color.text.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        padding: "4px 8px",
        fontSize: 12,
        cursor: "pointer",
        minWidth: 70,
        "&:focus": {
            outline: "none",
            borderColor: color.border.active,
        },
    },

    "& .url-input": {
        flex: "1 1 auto",
        background: color.background.default,
        color: color.text.default,
        border: `1px solid ${color.border.default}`,
        borderRadius: 3,
        padding: "4px 8px",
        fontSize: 12,
        fontFamily: "inherit",
        "&:focus": {
            outline: "none",
            borderColor: color.border.active,
        },
        "&::placeholder": {
            color: color.text.light,
        },
    },

    "& .server-info": {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        fontSize: 11,
        color: color.text.light,
        borderBottom: `1px solid ${color.border.light}`,
    },

    "& .server-name": {
        color: color.text.default,
        fontWeight: 500,
    },

    "& .capability-badge": {
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 6px",
        borderRadius: 3,
        fontSize: 11,
        cursor: "pointer",
        background: color.background.light,
        color: color.text.light,
        border: `1px solid ${color.border.light}`,
        "&:hover": {
            borderColor: color.border.active,
            color: color.text.default,
        },
    },

    "& .capability-badge.active": {
        borderColor: color.border.active,
        color: color.text.default,
    },

    "& .body": {
        flex: "1 1 auto",
        display: "flex",
        overflow: "hidden",
    },

    "& .main-panel": {
        flex: "1 1 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "auto",
    },

    "& .empty-state": {
        textAlign: "center" as const,
        color: color.text.light,
        fontSize: 13,
        padding: 20,
        lineHeight: 1.6,
    },

    "& .error-message": {
        color: color.error.text,
        fontSize: 12,
        padding: "4px 10px",
        background: color.error.background,
        borderBottom: `1px solid ${color.error.border}`,
    },

    "& .status-dot": {
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        marginRight: 4,
    },

    "& .status-dot.connected": {
        background: color.success.text,
    },

    "& .status-dot.connecting": {
        background: color.warning.text,
    },

    "& .status-dot.disconnected": {
        background: color.text.light,
    },

    "& .status-dot.error": {
        background: color.error.text,
    },

    // Server Info panel
    "& .info-panel": {
        flex: "1 1 auto",
        overflow: "auto",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
    },

    "& .info-field": {
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },

    "& .info-label": {
        fontSize: 11,
        fontWeight: 500,
        color: color.text.light,
        textTransform: "uppercase" as const,
        letterSpacing: "0.5px",
    },

    "& .info-value": {
        fontSize: 13,
        color: color.text.default,
    },

    "& .info-link": {
        fontSize: 13,
        color: color.border.active,
        textDecoration: "none",
        cursor: "pointer",
        "&:hover": {
            textDecoration: "underline",
        },
    },

    "& .info-instructions": {
        flex: "1 1 auto",
        border: `1px solid ${color.border.default}`,
        borderRadius: 4,
        overflow: "auto",
        padding: "8px 12px",
    },

    // Connections list (when disconnected)
    "& .connections-list": {
        width: "100%",
        maxWidth: 560,
        padding: "0 20px",
    },

    "& .connections-header": {
        fontSize: 14,
        fontWeight: 500,
        color: color.text.default,
        marginBottom: 12,
    },

    "& .conn-item": {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 4,
        cursor: "pointer",
        border: `1px solid ${color.border.light}`,
        marginBottom: 6,
        "&:hover": {
            background: color.background.light,
            borderColor: color.border.default,
        },
    },

    "& .conn-item.active": {
        borderColor: color.border.active,
        background: color.background.light,
    },

    "& .conn-details": {
        flex: "1 1 auto",
        minWidth: 0,
        overflow: "hidden",
    },

    "& .conn-name": {
        fontSize: 13,
        fontWeight: 500,
        color: color.text.default,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    "& .conn-url": {
        fontSize: 12,
        color: color.text.default,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },

    "& .conn-transport-badge": {
        fontSize: 10,
        color: color.text.light,
        background: color.background.light,
        border: `1px solid ${color.border.light}`,
        padding: "2px 6px",
        borderRadius: 2,
        flexShrink: 0,
    },

    "& .conn-delete": {
        fontSize: 16,
        color: color.text.light,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "2px 6px",
        borderRadius: 3,
        opacity: 0,
        flexShrink: 0,
        "&:hover": {
            color: color.error.text,
            background: color.background.light,
        },
    },

    "& .conn-item:hover .conn-delete": {
        opacity: 1,
    },

    "& .connections-hint": {
        fontSize: 11,
        color: color.text.light,
        marginTop: 8,
        lineHeight: 1.5,
    },
});

// ============================================================================
// Component
// ============================================================================

interface McpInspectorViewProps {
    model: McpInspectorModel;
}

function McpInspectorView({ model }: McpInspectorViewProps) {
    const s = model.state.use();
    const storeState = mcpConnectionStore.state.use();
    const isConnected = s.connectionStatus === "connected";
    const isConnecting = s.connectionStatus === "connecting";
    const connections = storeState.connections;

    // Load connections store on mount
    useEffect(() => { mcpConnectionStore.load(); }, []);

    const handleConnect = useCallback(() => {
        if (isConnected || isConnecting) {
            model.disconnect();
        } else {
            model.connect();
        }
    }, [model, isConnected, isConnecting]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !isConnected && !isConnecting) {
            model.connect();
        }
    }, [model, isConnected, isConnecting]);

    const handleSelectSaved = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value;
        if (!id) return;
        const conn = connections.find((c) => c.id === id);
        if (conn) model.fillFromSaved(conn);
        e.target.value = "";
    }, [model, connections]);

    const handleClickConnection = useCallback((id: string) => {
        const conn = connections.find((c) => c.id === id);
        if (conn) model.fillFromSaved(conn);
    }, [model, connections]);

    const handleDeleteConnection = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        model.deleteSavedConnection(id);
    }, [model]);

    return (
        <McpInspectorViewRoot>
            {/* Connection bar */}
            <PageToolbar borderBottom>
                <div className="connection-bar">
                    {connections.length > 0 && !isConnected && !isConnecting && (
                        <>
                            <select
                                className="saved-select"
                                value=""
                                onChange={handleSelectSaved}
                            >
                                <option value="">Saved…</option>
                                {connections.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.transport === "http" ? c.url : `${c.command} ${c.args}`}
                                    </option>
                                ))}
                            </select>
                            <span className="bar-separator" />
                        </>
                    )}

                    <select
                        className="transport-select"
                        value={s.transportType}
                        onChange={(e) => model.state.update((st) => {
                            st.transportType = e.target.value as "http" | "stdio";
                        })}
                        disabled={isConnected || isConnecting}
                    >
                        <option value="http">HTTP</option>
                        <option value="stdio">Stdio</option>
                    </select>

                    {s.transportType === "http" ? (
                        <input
                            className="url-input"
                            type="text"
                            placeholder="http://localhost:7865/mcp"
                            value={s.url}
                            onChange={(e) => model.state.update((st) => { st.url = e.target.value; })}
                            onKeyDown={handleKeyDown}
                            disabled={isConnected || isConnecting}
                        />
                    ) : (
                        <>
                            <input
                                className="url-input"
                                type="text"
                                placeholder="command (e.g. npx)"
                                value={s.command}
                                onChange={(e) => model.state.update((st) => { st.command = e.target.value; })}
                                onKeyDown={handleKeyDown}
                                disabled={isConnected || isConnecting}
                                style={{ flex: "0 0 160px" }}
                            />
                            <input
                                className="url-input"
                                type="text"
                                placeholder="args (e.g. -y @modelcontextprotocol/server-filesystem /path)"
                                value={s.args}
                                onChange={(e) => model.state.update((st) => { st.args = e.target.value; })}
                                onKeyDown={handleKeyDown}
                                disabled={isConnected || isConnecting}
                            />
                        </>
                    )}

                    <Button
                        type="flat"
                        size="small"
                        onClick={handleConnect}
                        disabled={isConnecting}
                    >
                        {isConnecting ? "Connecting…" : isConnected ? "Disconnect" : "Connect"}
                    </Button>
                </div>
            </PageToolbar>

            {/* Error message */}
            {s.connectionStatus === "error" && s.errorMessage && (
                <div className="error-message">{s.errorMessage}</div>
            )}

            {/* Server info bar (when connected) */}
            {isConnected && (
                <div className="server-info">
                    <span className="status-dot connected" />
                    <span className="server-name">{s.serverTitle || s.serverName}</span>
                    {s.serverVersion && <span>v{s.serverVersion}</span>}
                    <span style={{ margin: "0 4px" }}>—</span>
                    <span
                        className={`capability-badge${s.activePanel === "info" ? " active" : ""}`}
                        onClick={() => model.setActivePanel("info")}
                    >
                        Info
                    </span>
                    {s.hasTools && (
                        <span
                            className={`capability-badge${s.activePanel === "tools" ? " active" : ""}`}
                            onClick={() => model.setActivePanel("tools")}
                        >
                            Tools
                        </span>
                    )}
                    {s.hasResources && (
                        <span
                            className={`capability-badge${s.activePanel === "resources" ? " active" : ""}`}
                            onClick={() => model.setActivePanel("resources")}
                        >
                            Resources
                        </span>
                    )}
                    {s.hasPrompts && (
                        <span
                            className={`capability-badge${s.activePanel === "prompts" ? " active" : ""}`}
                            onClick={() => model.setActivePanel("prompts")}
                        >
                            Prompts
                        </span>
                    )}
                    <span
                        className={`capability-badge${s.activePanel === "history" ? " active" : ""}`}
                        onClick={() => model.setActivePanel("history")}
                    >
                        History
                    </span>
                </div>
            )}

            {/* Body: panel content */}
            <div className="body">
                {isConnected && s.activePanel === "info" && (
                    <ServerInfoPanel state={s} />
                )}
                {isConnected && s.activePanel === "tools" && (
                    <ToolsPanel model={model} />
                )}
                {isConnected && s.activePanel === "resources" && (
                    <ResourcesPanel model={model} />
                )}
                {isConnected && s.activePanel === "prompts" && (
                    <PromptsPanel model={model} />
                )}
                {isConnected && s.activePanel === "history" && (
                    <HistoryPanel model={model} />
                )}
                {!isConnected && (
                    <div className="main-panel">
                        {connections.length > 0 && s.connectionStatus === "disconnected" ? (
                            <div className="connections-list">
                                <div className="connections-header">Saved Connections</div>
                                {connections.map((c) => {
                                    const isActive = c.transport === s.transportType
                                        && (c.transport === "http" ? c.url === s.url : c.command === s.command && c.args === s.args);
                                    return (
                                    <div
                                        key={c.id}
                                        className={`conn-item${isActive ? " active" : ""}`}
                                        onClick={() => handleClickConnection(c.id)}
                                    >
                                        <div className="conn-details">
                                            <div className="conn-url">
                                                {c.transport === "http" ? c.url : `${c.command} ${c.args}`}
                                            </div>
                                        </div>
                                        <span className="conn-transport-badge">{c.transport.toUpperCase()}</span>
                                        <button
                                            className="conn-delete"
                                            title="Delete connection"
                                            onClick={(e) => handleDeleteConnection(e, c.id)}
                                        >
                                            &times;
                                        </button>
                                    </div>
                                    );
                                })}
                                <div className="connections-hint">
                                    Click a connection to fill the connection bar, then click Connect.
                                </div>
                            </div>
                        ) : (
                            <div className="empty-state">
                                {s.connectionStatus === "disconnected" && (
                                    <>
                                        Enter a server URL or command above and click
                                        <strong> Connect</strong> to get started.
                                    </>
                                )}
                                {s.connectionStatus === "error" && (
                                    <>
                                        Connection failed. Check the URL and try again.
                                    </>
                                )}
                                {isConnecting && (
                                    <>Connecting…</>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </McpInspectorViewRoot>
    );
}

// ============================================================================
// Server Info Panel
// ============================================================================

function ServerInfoPanel({ state }: { state: McpInspectorPageState }) {
    const displayName = state.serverTitle || state.serverName;
    const handleWebsiteClick = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if (state.serverWebsiteUrl) {
            import("../../api/pages").then(({ pagesModel }) =>
                pagesModel.openUrlInBrowserTab(state.serverWebsiteUrl),
            );
        }
    }, [state.serverWebsiteUrl]);

    return (
        <div className="info-panel">
            <div className="info-field">
                <div className="info-label">Server Name</div>
                <div className="info-value">{displayName}</div>
            </div>
            {state.serverVersion && (
                <div className="info-field">
                    <div className="info-label">Version</div>
                    <div className="info-value">{state.serverVersion}</div>
                </div>
            )}
            {state.serverDescription && (
                <div className="info-field">
                    <div className="info-label">Description</div>
                    <div className="info-value">{state.serverDescription}</div>
                </div>
            )}
            {state.serverWebsiteUrl && (
                <div className="info-field">
                    <div className="info-label">Website</div>
                    <a
                        className="info-link"
                        href={state.serverWebsiteUrl}
                        onClick={handleWebsiteClick}
                    >
                        {state.serverWebsiteUrl}
                    </a>
                </div>
            )}
            {state.instructions && (
                <div className="info-field" style={{ flex: "1 1 auto" }}>
                    <div className="info-label">Instructions</div>
                    <div className="info-instructions">
                        <MarkdownBlock content={state.instructions} compact />
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// History Panel
// ============================================================================

function HistoryPanel({ model }: { model: McpInspectorModel }) {
    const count = model.historyCount;

    const handleShow = useCallback(() => { model.showHistory(); }, [model]);
    const handleClear = useCallback(() => { model.clearHistory(); }, [model]);

    if (count === 0) {
        return (
            <div className="main-panel">
                <div className="empty-state">No requests recorded yet.</div>
            </div>
        );
    }

    return (
        <div className="main-panel">
            <div className="empty-state">
                <div>{count} request{count !== 1 ? "s" : ""} recorded</div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>
                    <Button type="flat" size="small" onClick={handleShow}>
                        Open in Log View
                    </Button>
                    <Button type="flat" size="small" onClick={handleClear}>
                        Clear
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// Editor Module
// ============================================================================

const mcpInspectorEditorModule: EditorModule = {
    Editor: McpInspectorView,

    newPageModel: async () => {
        return new McpInspectorModel(new TComponentState(getDefaultMcpInspectorPageState()));
    },

    newEmptyPageModel: async (pageType: PageType) => {
        if (pageType !== "mcpInspectorPage") return null;
        return new McpInspectorModel(
            new TComponentState(getDefaultMcpInspectorPageState()),
        );
    },

    newPageModelFromState: async (state: Partial<IPageState>) => {
        const s: McpInspectorPageState = {
            ...getDefaultMcpInspectorPageState(),
            ...(state as Partial<McpInspectorPageState>),
        };
        return new McpInspectorModel(new TComponentState(s));
    },
};

export default mcpInspectorEditorModule;
