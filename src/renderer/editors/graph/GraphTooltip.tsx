import styled from "@emotion/styled";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { GraphNode, getCustomProperties } from "./types";
import color from "../../theme/color";

// =============================================================================
// Styled
// =============================================================================

const GraphTooltipRoot = styled.div({
    position: "fixed",
    zIndex: 10,
    pointerEvents: "none",
    backgroundColor: color.background.default,
    color: color.graph.labelText,
    border: `1px solid ${color.border.default}`,
    borderRadius: 4,
    padding: "6px 8px",
    fontSize: 12,
    maxWidth: 300,
    boxShadow: `0 2px 8px ${color.shadow.default}`,
    lineHeight: 1.4,
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
});

// =============================================================================
// Component
// =============================================================================

interface GraphTooltipProps {
    node: GraphNode;
    x: number;
    y: number;
    /** Number of group members (only set for group nodes). */
    memberCount?: number;
}

const OFFSET = 12;

function GraphTooltip({ node, x, y, memberCount }: GraphTooltipProps) {
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

    const title = node.title || node.id;
    const showId = !!node.title;
    const customProps = getCustomProperties(node);

    return ReactDOM.createPortal(
        <GraphTooltipRoot ref={ref} style={{ left: pos.left, top: pos.top }}>
            <div className="tooltip-title">{title}</div>
            {showId && <div className="tooltip-id">{node.id}</div>}
            {memberCount !== undefined && (
                <div className="tooltip-id">Group · {memberCount} member{memberCount !== 1 ? "s" : ""}</div>
            )}
            {customProps.length > 0 && (
                <div className="tooltip-props">
                    {customProps.map(([key, value]) => (
                        <Fragment key={key}>
                            <span className="tooltip-key">{key}</span>
                            <span className="tooltip-value" title={value}>{value}</span>
                        </Fragment>
                    ))}
                </div>
            )}
        </GraphTooltipRoot>,
        document.body,
    );
}

export { GraphTooltip };
