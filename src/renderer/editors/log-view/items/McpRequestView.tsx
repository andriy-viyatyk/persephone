import { useState } from "react";
import styled from "@emotion/styled";
import color from "../../../theme/color";
import { McpRequestEntry } from "../logTypes";
import { ColorizedCode } from "../../shared/ColorizedCode";

// =============================================================================
// Styles
// =============================================================================

const McpRequestRoot = styled.div({
    fontSize: 13,
    lineHeight: "20px",
    fontFamily: "Consolas, 'Courier New', monospace",

    "& .mcp-req-header": {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 8px",
        cursor: "pointer",
        userSelect: "none",
        "&:hover": {
            background: color.background.light,
        },
    },

    "& .mcp-req-chevron": {
        fontSize: 10,
        color: color.text.light,
        flexShrink: 0,
        width: 10,
    },

    "& .mcp-req-method": {
        fontWeight: 600,
        color: color.text.default,
    },

    "& .mcp-req-detail": {
        color: color.text.light,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: "1 1 auto",
        minWidth: 0,
    },

    "& .mcp-req-spacer": {
        flex: "1 1 auto",
    },

    "& .mcp-req-duration": {
        fontSize: 11,
        color: color.text.light,
        flexShrink: 0,
    },

    "& .mcp-req-error-badge": {
        fontSize: 11,
        color: color.error.text,
        fontWeight: 600,
        flexShrink: 0,
    },

    "& .mcp-req-card": {
        margin: "4px 8px 6px 24px",
        border: `1px solid ${color.border.default}`,
        borderRadius: 6,
        overflow: "hidden",
    },

    "& .mcp-req-card-header": {
        padding: "3px 10px",
        fontSize: 11,
        fontWeight: 600,
        color: color.text.light,
        background: color.background.dark,
        userSelect: "none",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
    },

    "& .mcp-req-card-content": {
        maxHeight: 180,
        overflow: "auto",
    },

    "& .mcp-req-card-divider": {
        height: 1,
        background: color.border.default,
    },

    "& .mcp-req-json": {
        padding: "6px 10px",
        fontSize: 12,
        lineHeight: "18px",
        margin: 0,
    },

    "& .mcp-req-empty": {
        display: "block",
        padding: "6px 10px",
        color: color.text.light,
        fontSize: 12,
    },

    "& .mcp-req-error-text": {
        display: "block",
        padding: "6px 10px",
        color: color.error.text,
        fontSize: 12,
    },
});

// =============================================================================
// Component
// =============================================================================

interface McpRequestViewProps {
    entry: McpRequestEntry;
}

/** Extract a short informative detail string from request method + params. */
function getDetail(method: string, params: any): string {
    if (!params) return "";
    if (method === "tools/call") return params.name || "";
    if (method === "resources/read") return params.uri || "";
    if (method === "prompts/get") return params.name || "";
    if (method === "create_page") return params.title || "";
    if (method === "set_page_content") return params.title || params.id || "";
    if (method === "get_page_content") return params.title || params.id || "";
    if (method === "open_url") return params.url || "";
    // Generic fallback: first informative string field
    for (const key of ["title", "name", "url", "uri", "id", "path"]) {
        if (typeof params[key] === "string" && params[key].length > 0) {
            return params[key];
        }
    }
    return "";
}

export function McpRequestView({ entry }: McpRequestViewProps) {
    const [expanded, setExpanded] = useState(false);

    const detail = getDetail(entry.method, entry.params);
    const hasError = !!entry.error;

    return (
        <McpRequestRoot>
            <div className="mcp-req-header" onClick={() => setExpanded((v) => !v)}>
                <span className="mcp-req-chevron">{expanded ? "\u25BC" : "\u25B6"}</span>
                <span className="mcp-req-method">{entry.method}</span>
                {detail ? <span className="mcp-req-detail">{detail}</span> : <span className="mcp-req-spacer" />}
                {hasError && <span className="mcp-req-error-badge">ERROR</span>}
                <span className="mcp-req-duration">{entry.durationMs}ms</span>
            </div>

            {expanded && (
                <div className="mcp-req-card">
                    <div>
                        <div className="mcp-req-card-header">Request</div>
                        <div className="mcp-req-card-content">
                            {entry.params != null ? (
                                <pre className="mcp-req-json">
                                    <ColorizedCode
                                        code={JSON.stringify(entry.params, null, 2)}
                                        language="json"
                                        tabSize={2}
                                    />
                                </pre>
                            ) : (
                                <span className="mcp-req-empty">(no params)</span>
                            )}
                        </div>
                    </div>
                    <div className="mcp-req-card-divider" />
                    <div>
                        <div className="mcp-req-card-header">Response</div>
                        <div className="mcp-req-card-content">
                            {hasError ? (
                                <span className="mcp-req-error-text">{entry.error}</span>
                            ) : entry.result != null ? (
                                <pre className="mcp-req-json">
                                    <ColorizedCode
                                        code={JSON.stringify(entry.result, null, 2)}
                                        language="json"
                                        tabSize={2}
                                    />
                                </pre>
                            ) : (
                                <span className="mcp-req-empty">(no result)</span>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </McpRequestRoot>
    );
}
