import { useState, useEffect, useCallback } from "react";
import styled from "@emotion/styled";
import * as monaco from "monaco-editor";
import color from "../../../theme/color";
import { McpRequestEntry } from "../logTypes";

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
        padding: "4px 8px",
        cursor: "pointer",
        userSelect: "none",
        "&:hover": {
            background: color.background.light,
        },
    },

    "& .mcp-req-direction": {
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
    },

    "& .mcp-req-direction.outgoing": {
        color: color.misc.blue,
    },

    "& .mcp-req-direction.incoming": {
        color: color.misc.green,
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

    "& .mcp-req-section": {
        padding: "0 8px",
    },

    "& .mcp-req-section-header": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 0",
        cursor: "pointer",
        userSelect: "none",
        fontSize: 12,
        color: color.text.light,
        "&:hover": {
            color: color.text.default,
        },
    },

    "& .mcp-req-json": {
        maxHeight: 200,
        overflow: "auto",
        padding: "4px 8px",
        fontSize: 12,
        lineHeight: "18px",
        background: color.background.dark,
        borderRadius: 3,
        marginBottom: 4,
        "& .mtk1": {
            color: color.text.default,
        },
    },

    "& .mcp-req-error-text": {
        color: color.error.text,
        padding: "4px 8px",
        fontSize: 12,
        marginBottom: 4,
    },
});

// =============================================================================
// Colorized JSON Block
// =============================================================================

function ColorizedJson({ data }: { data: any }) {
    const [html, setHtml] = useState<string | null>(null);
    const text = JSON.stringify(data, null, 2);

    useEffect(() => {
        let cancelled = false;
        monaco.editor.colorize(text, "json", { tabSize: 2 }).then((result) => {
            if (!cancelled) setHtml(result);
        });
        return () => { cancelled = true; };
    }, [text]);

    if (!html) {
        return <pre className="mcp-req-json">{text}</pre>;
    }

    return (
        <pre
            className="mcp-req-json"
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

// =============================================================================
// Component
// =============================================================================

interface McpRequestViewProps {
    entry: McpRequestEntry;
}

/** Extract a short detail string from a request method + params. */
function getDetail(method: string, params: any): string {
    if (!params) return "";
    if (method === "tools/call") return params.name || "";
    if (method === "resources/read") return params.uri || "";
    if (method === "prompts/get") return params.name || "";
    return "";
}

export function McpRequestView({ entry }: McpRequestViewProps) {
    const [requestOpen, setRequestOpen] = useState(false);
    const [responseOpen, setResponseOpen] = useState(false);

    const toggleRequest = useCallback(() => setRequestOpen((v) => !v), []);
    const toggleResponse = useCallback(() => setResponseOpen((v) => !v), []);

    const detail = getDetail(entry.method, entry.params);
    const arrow = entry.direction === "outgoing" ? "\u2192" : "\u2190";
    const hasError = !!entry.error;

    return (
        <McpRequestRoot>
            <div className="mcp-req-header" onClick={toggleRequest}>
                <span className={`mcp-req-direction ${entry.direction}`}>
                    {arrow} {entry.direction}
                </span>
                <span className="mcp-req-method">{entry.method}</span>
                {detail && <span className="mcp-req-detail">{detail}</span>}
                {hasError && <span className="mcp-req-error-badge">ERROR</span>}
                <span className="mcp-req-duration">{entry.durationMs}ms</span>
            </div>

            <div className="mcp-req-section">
                <div className="mcp-req-section-header" onClick={toggleRequest}>
                    {requestOpen ? "\u25BC" : "\u25B6"} Request
                </div>
                {requestOpen && entry.params != null && (
                    <ColorizedJson data={entry.params} />
                )}
                {requestOpen && entry.params == null && (
                    <div className="mcp-req-json" style={{ color: color.text.light }}>
                        (no params)
                    </div>
                )}
            </div>

            <div className="mcp-req-section">
                <div className="mcp-req-section-header" onClick={toggleResponse}>
                    {responseOpen ? "\u25BC" : "\u25B6"} Response
                </div>
                {responseOpen && hasError && (
                    <div className="mcp-req-error-text">{entry.error}</div>
                )}
                {responseOpen && entry.result != null && (
                    <ColorizedJson data={entry.result} />
                )}
                {responseOpen && !hasError && entry.result == null && (
                    <div className="mcp-req-json" style={{ color: color.text.light }}>
                        (no result)
                    </div>
                )}
            </div>
        </McpRequestRoot>
    );
}
