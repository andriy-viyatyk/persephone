import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing, radius } from "../tokens";

// --- Types ---

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Padding override in px. Default: spacing.xl (16px). Use spacing.* tokens. */
    padding?: number | string;
    /** Gap between children in px. Use gap.* tokens from uikit/tokens. */
    gap?: number | string;
}

// --- Styled ---

const Root = styled.div({
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.background.default,
    borderRadius: radius.lg,
    boxShadow: `0 2px 8px ${color.shadow.default}`,
    padding: spacing.xl,
}, { label: "Card" });

// --- Component ---

export function Card({
    padding: paddingProp,
    gap: gapProp,
    children,
    style,
    ...rest
}: CardProps) {
    return (
        <Root
            data-type="card"
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
