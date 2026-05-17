import { StyledText } from "../logTypes";
import { StyledTextView } from "../StyledTextView";
import { Panel, Text } from "../../../uikit";

// =============================================================================
// Component
// =============================================================================

interface DialogHeaderProps {
    title?: StyledText;
}

export function DialogHeader({ title }: DialogHeaderProps) {
    if (!title) return null;
    return (
        <Panel name="log-dialog-header" background="dark" rounded="md" paddingX="md" paddingY="xs">
            <Text size="md" color="light">
                <StyledTextView text={title} />
            </Text>
        </Panel>
    );
}
