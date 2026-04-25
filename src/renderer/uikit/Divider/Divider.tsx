import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";

// --- Types ---

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Line direction. Default: "horizontal". */
    orientation?: "horizontal" | "vertical";
}

// --- Styled ---

const Root = styled.div(
    {
        flexShrink: 0,
        backgroundColor: color.border.default,

        // Default: horizontal
        height: 1,
        width: "100%",

        '&[data-orientation="vertical"]': {
            width: 1,
            height: "auto",
            alignSelf: "stretch",
        },
    },
    { label: "Divider" },
);

// --- Component ---

export function Divider({ orientation = "horizontal", ...rest }: DividerProps) {
    return (
        <Root
            data-type="divider"
            data-orientation={orientation}
            role="separator"
            aria-orientation={orientation}
            {...rest}
        />
    );
}
