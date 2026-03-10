import styled from "@emotion/styled";
import { LogMessageEntry } from "./logTypes";
import { StyledTextView } from "./StyledTextView";
import color from "../../theme/color";

// =============================================================================
// Styled Components
// =============================================================================

const LogMessageRoot = styled.div({
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 14,
    lineHeight: "18px",
    minHeight: 18,
    fontFamily: "Consolas, 'Courier New', monospace",

    "&.level-log": {
        color: color.text.light,
    },
    "&.level-info": {
        color: color.misc.blue,
    },
    "&.level-warn": {
        color: color.misc.yellow,
    },
    "&.level-error": {
        color: color.misc.red,
    },
    "&.level-success": {
        color: color.misc.green,
    },
});

// =============================================================================
// Component
// =============================================================================

const levelClassMap: Record<string, string> = {
    "log.log": "level-log",
    "log.info": "level-info",
    "log.warn": "level-warn",
    "log.error": "level-error",
    "log.success": "level-success",
};

export function LogMessageView({ entry }: { entry: LogMessageEntry }) {
    const className = levelClassMap[entry.type] || "";
    return (
        <LogMessageRoot className={className}>
            <StyledTextView text={entry.text} />
        </LogMessageRoot>
    );
}
