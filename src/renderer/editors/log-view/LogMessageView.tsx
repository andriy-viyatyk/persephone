import { LogMessageEntry } from "./logTypes";
import { StyledTextView } from "./StyledTextView";
import { Panel, Text, TextProps } from "../../uikit";

// =============================================================================
// Component
// =============================================================================

function colorForLevel(type: string): TextProps["color"] {
    switch (type) {
        case "log.log":     return "light";
        case "log.info":    return "primary";
        case "log.warn":    return "warning";
        case "log.error":   return "error";
        case "log.success": return "success";
        default:            return "default";
    }
}

export function LogMessageView({ entry }: { entry: LogMessageEntry }) {
    return (
        <Panel name="log-message" wordBreak="break-word">
            <Text
                color={colorForLevel(entry.type)}
                preWrap
                size="base"
            >
                <StyledTextView text={entry.text} />
            </Text>
        </Panel>
    );
}
