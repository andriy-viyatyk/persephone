import { RefObject } from "react";
import styled from "@emotion/styled";
import { LogEntry } from "./logTypes";
import { LogEntryContent } from "./LogEntryContent";
import color from "../../theme/color";

// =============================================================================
// Styled Components
// =============================================================================

const WrapperRoot = styled.div({
    width: "100%",
    height: "fit-content",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    padding: "0 12px",
    borderLeft: "3px solid transparent",

    "&.accent-info": {
        borderLeftColor: color.misc.blue,
    },
    "&.accent-warn": {
        borderLeftColor: color.misc.yellow,
    },
    "&.accent-error": {
        borderLeftColor: color.misc.red,
    },
    "&.accent-success": {
        borderLeftColor: color.misc.green,
    },

    "& .entry-timestamp": {
        flexShrink: 0,
        marginRight: 10,
        fontSize: 12,
        lineHeight: "18px",
        color: color.text.light,
        fontFamily: "Consolas, 'Courier New', monospace",
        userSelect: "none",
    },

    "& .entry-content": {
        flex: "1 1 auto",
        minWidth: 0,
    },
});

// =============================================================================
// Helpers
// =============================================================================

const accentClassMap: Record<string, string> = {
    "log.info": "accent-info",
    "log.warn": "accent-warn",
    "log.error": "accent-error",
    "log.success": "accent-success",
};

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
}

// =============================================================================
// Component
// =============================================================================

interface LogEntryWrapperProps {
    entry: LogEntry;
    cellRef?: RefObject<HTMLDivElement>;
    showTimestamp?: boolean;
}

export function LogEntryWrapper({ entry, cellRef, showTimestamp }: LogEntryWrapperProps) {
    const accentClass = accentClassMap[entry.type] || "";

    return (
        <WrapperRoot ref={cellRef as any} className={accentClass}>
            {showTimestamp && entry.timestamp != null && (
                <div className="entry-timestamp">{formatTimestamp(entry.timestamp)}</div>
            )}
            <div className="entry-content">
                <LogEntryContent entry={entry} />
            </div>
        </WrapperRoot>
    );
}
