import React, { forwardRef } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing } from "../tokens";

// --- Types ---

export interface SectionItemProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Stable id (forwarded so callers using aria can wire labelling). */
    id?: string;
    /** Section label. */
    label: React.ReactNode;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        width: "100%",
        boxSizing: "border-box",
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: spacing.sm,
        paddingRight: spacing.sm,
        color: color.text.light,
        cursor: "default",
        userSelect: "none",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
    },
    { label: "ListBoxSection" },
);

// --- Component ---

export const SectionItem = forwardRef<HTMLDivElement, SectionItemProps>(function SectionItem(
    { id, label, ...rest },
    ref,
) {
    return (
        <Root
            ref={ref}
            id={id}
            data-type="list-section"
            role="presentation"
            {...rest}
        >
            {label}
        </Root>
    );
});
