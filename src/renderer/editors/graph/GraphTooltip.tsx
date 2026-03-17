import styled from "@emotion/styled";
import { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { GraphNode, getCustomProperties, toNavigableHref } from "./types";
import { pagesModel } from "../../api/pages";
import color from "../../theme/color";

// =============================================================================
// Styled
// =============================================================================

const GraphTooltipRoot = styled.div({
    position: "fixed",
    zIndex: 10,
    pointerEvents: "auto",
    userSelect: "text",
    cursor: "text",
    backgroundColor: color.background.default,
    color: color.graph.labelText,
    border: `1px solid ${color.border.default}`,
    borderRadius: 4,
    padding: "6px 8px",
    fontSize: 12,
    maxWidth: 300,
    boxShadow: `0 2px 8px ${color.shadow.default}`,
    lineHeight: 1.4,
    "& .tooltip-badge": {
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
        color: color.graph.nodeSpecial,
        marginBottom: 2,
    },
    "& .tooltip-title": {
        fontWeight: 600,
        marginBottom: 2,
    },
    "& .tooltip-id": {
        fontSize: 11,
        opacity: 0.7,
        marginBottom: 4,
    },
    "& .tooltip-props": {
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "1px 8px",
        fontSize: 11,
        borderTop: `1px solid ${color.border.default}`,
        paddingTop: 4,
        marginTop: 2,
    },
    "& .tooltip-key": {
        opacity: 0.7,
    },
    "& .tooltip-value": {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "& .tooltip-link": {
        color: color.graph.nodeSpecial,
        cursor: "pointer",
        textDecoration: "none",
        "&:hover": {
            textDecoration: "underline",
        },
    },
    "& .tooltip-header": {
        display: "flex",
        alignItems: "flex-start",
        gap: 4,
    },
    "& .tooltip-header-content": {
        flex: 1,
        minWidth: 0,
    },
    "& .tooltip-copy": {
        flexShrink: 0,
        width: 20,
        height: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        borderRadius: 3,
        border: "none",
        background: "transparent",
        color: color.graph.labelText,
        opacity: 0.5,
        padding: 0,
        fontSize: 12,
        "&:hover": {
            opacity: 1,
            backgroundColor: color.background.light,
        },
    },
});

// =============================================================================
// Component
// =============================================================================

interface GraphTooltipProps {
    node: GraphNode;
    x: number;
    y: number;
    /** Whether this node is the root node. */
    isRoot?: boolean;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
}

const OFFSET = 12;

/** Parse text that may contain markdown links into React elements. */
function renderWithLinks(text: string): React.ReactNode {
    const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = LINK_RE.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        const [, linkText, href] = match;
        parts.push(
            <a
                key={match.index}
                className="tooltip-link"
                href={toNavigableHref(href)}
                title={href}
            >
                {linkText}
            </a>,
        );
        lastIndex = match.index + match[0].length;
    }

    if (parts.length === 0) return text;
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return <>{parts}</>;
}

/** Build markdown representation of the tooltip content for clipboard. */
export function buildMarkdown(node: GraphNode, isRoot?: boolean): string {
    const lines: string[] = [];
    const title = node.title || node.id;

    if (isRoot) lines.push("**Root Node**");
    if (node.isGroup) lines.push("**Group**");
    lines.push(`## ${title}`);
    if (node.title) lines.push(`\`${node.id}\``);

    const customProps = getCustomProperties(node);
    if (customProps.length > 0) {
        lines.push("");
        lines.push("| Property | Value |");
        lines.push("|----------|-------|");
        for (const [key, value] of customProps) {
            // Escape pipe characters in values for table cells
            const escaped = value.replace(/\|/g, "\\|");
            lines.push(`| ${key} | ${escaped} |`);
        }
    }

    return lines.join("\n");
}

/** Copy icon (two overlapping rectangles). */
const CopyIcon = () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5.5" y="5.5" width="9" height="9" rx="1" />
        <path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" />
    </svg>
);

/** Check icon (shown briefly after copy). */
const CheckIcon = () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 8 7 12 13 4" />
    </svg>
);

/** Open/launch icon (matches OpenLinkIcon from the Links editor). */
const OpenIcon = () => (
    <svg width="12" height="12" viewBox="0 0 24 24">
        <path d="M14 4l6 5-6 5V10c-5 0-9 2-11 7 1-7 5-11 11-12V4z" fill="currentColor" />
    </svg>
);

function GraphTooltip({ node, x, y, isRoot, onMouseEnter, onMouseLeave }: GraphTooltipProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: x + OFFSET, top: y + OFFSET });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        let left = x + OFFSET;
        let top = y + OFFSET;

        if (left + rect.width > window.innerWidth - OFFSET) {
            left = x - rect.width - OFFSET;
        }
        if (top + rect.height > window.innerHeight - OFFSET) {
            top = y - rect.height - OFFSET;
        }

        setPos({ left, top });
    }, [x, y]);

    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        const md = buildMarkdown(node, isRoot);
        navigator.clipboard.writeText(md).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [node, isRoot]);

    const handleOpen = useCallback(() => {
        const md = buildMarkdown(node, isRoot);
        const title = node.title || node.id;
        pagesModel.addEditorPage("md-view", "markdown", title, md);
    }, [node, isRoot]);

    const title = node.title || node.id;
    const showId = !!node.title;
    const customProps = getCustomProperties(node);

    return ReactDOM.createPortal(
        <GraphTooltipRoot ref={ref} style={{ left: pos.left, top: pos.top }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
            <div className="tooltip-header">
                <div className="tooltip-header-content">
                    {isRoot && <div className="tooltip-badge">Root Node</div>}
                    {node.isGroup && <div className="tooltip-badge">Group</div>}
                    <div className="tooltip-title">{renderWithLinks(title)}</div>
                    {showId && <div className="tooltip-id">{node.id}</div>}
                </div>
                <button className="tooltip-copy" onClick={handleCopy} title="Copy as Markdown">
                    {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button className="tooltip-copy" onClick={handleOpen} title="Open in new page">
                    <OpenIcon />
                </button>
            </div>
            {customProps.length > 0 && (
                <div className="tooltip-props">
                    {customProps.map(([key, value], i) => (
                        <Fragment key={i}>
                            <span className="tooltip-key">{key}</span>
                            <span className="tooltip-value" title={value}>{renderWithLinks(value)}</span>
                        </Fragment>
                    ))}
                </div>
            )}
        </GraphTooltipRoot>,
        document.body,
    );
}

export { GraphTooltip };
