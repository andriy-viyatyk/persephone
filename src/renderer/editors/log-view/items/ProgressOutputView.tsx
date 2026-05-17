import { ProgressOutputEntry } from "../logTypes";
import { StyledTextView } from "../StyledTextView";
import { Panel, ProgressBar, Text } from "../../../uikit";

// =============================================================================
// Component
// =============================================================================

interface ProgressOutputViewProps {
    entry: ProgressOutputEntry;
}

export function ProgressOutputView({ entry }: ProgressOutputViewProps) {
    const { label, value, max = 100, completed } = entry;

    return (
        <Panel name="log-progress" direction="column" gap="xs">
            {label && (
                <Panel name="log-progress-label-row" direction="row" align="center" gap="md">
                    <Text size="md"><StyledTextView text={label} /></Text>
                </Panel>
            )}
            <ProgressBar
                name="log-progress-bar"
                value={value}
                max={max}
                completed={completed}
                width={160}
            />
            {value != null && !completed && (
                <Text size="xs" color="light" name="log-progress-info">{value} / {max}</Text>
            )}
        </Panel>
    );
}
