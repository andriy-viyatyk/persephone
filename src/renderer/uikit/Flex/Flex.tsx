import React from "react";
import styled from "@emotion/styled";

// --- Types ---

export interface FlexProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Flex direction. Default: "row" */
    direction?: "row" | "column" | "row-reverse" | "column-reverse";
    /** Gap between children in px. Use gap.* tokens from uikit/tokens. */
    gap?: number | string;
    /** CSS align-items */
    align?: React.CSSProperties["alignItems"];
    /** CSS justify-content */
    justify?: React.CSSProperties["justifyContent"];
    /** Enable flex-wrap. `true` → "wrap", or pass any flexWrap value. */
    wrap?: boolean | React.CSSProperties["flexWrap"];
    /** CSS flex shorthand, e.g. "1 1 auto" or 1 */
    flex?: React.CSSProperties["flex"];
    /** Padding in px. Use spacing.* tokens from uikit/tokens. */
    padding?: number | string;
}

export type HStackProps = Omit<FlexProps, "direction">;
export type VStackProps = Omit<FlexProps, "direction">;

// --- Styled ---

const Root = styled.div({
    display: "flex",
}, { label: "Flex" });

// --- Components ---

export function Flex({
    direction = "row",
    gap: gapProp,
    align,
    justify,
    wrap,
    flex: flexProp,
    padding: paddingProp,
    children,
    style,
    ...rest
}: FlexProps) {
    return (
        <Root
            data-type="flex"
            {...rest}
            style={{
                flexDirection: direction,
                gap: gapProp,
                alignItems: align,
                justifyContent: justify,
                flexWrap: wrap === true ? "wrap" : wrap || undefined,
                flex: flexProp,
                padding: paddingProp,
                ...style,
            }}
        >
            {children}
        </Root>
    );
}

export function HStack(props: HStackProps) {
    return <Flex {...props} direction="row" data-type="h-stack" />;
}

export function VStack(props: VStackProps) {
    return <Flex {...props} direction="column" data-type="v-stack" />;
}
