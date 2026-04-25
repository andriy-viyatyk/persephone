import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing, radius } from "../tokens";

// --- Types ---

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Padding override in px. Default: spacing.md (8px). Use spacing.* tokens. */
    padding?: number | string;
    /** Gap between children in px. Use gap.* tokens from uikit/tokens. */
    gap?: number | string;
}

// --- Styled ---

const Root = styled.div({
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.background.default,
    border: `1px solid ${color.border.light}`,
    borderRadius: radius.md,
    padding: spacing.md,
}, { label: "Panel" });

// --- Component ---

export function Panel({
    padding: paddingProp,
    gap: gapProp,
    children,
    style,
    ...rest
}: PanelProps) {
    return (
        <Root
            data-type="panel"
            {...rest}
            style={{
                ...(paddingProp !== undefined && { padding: paddingProp }),
                ...(gapProp !== undefined && { gap: gapProp }),
                ...style,
            }}
        >
            {children}
        </Root>
    );
}
