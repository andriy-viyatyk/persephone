import styled from "@emotion/styled";
import { StyledText } from "../logTypes";
import { StyledTextView } from "../StyledTextView";
import color from "../../../theme/color";

// =============================================================================
// Styled Components
// =============================================================================

const HeaderRoot = styled.div({
    backgroundColor: color.background.dark,
    padding: "3px 8px",
    fontSize: 13,
    lineHeight: "18px",
    color: color.text.light,
});

// =============================================================================
// Component
// =============================================================================

interface DialogHeaderProps {
    title?: StyledText;
}

export function DialogHeader({ title }: DialogHeaderProps) {
    if (!title) return null;
    return (
        <HeaderRoot>
            <StyledTextView text={title} />
        </HeaderRoot>
    );
}
