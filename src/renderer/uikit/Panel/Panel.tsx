import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing, gap as gapTokens, radius } from "../tokens";

// --- Types ---

type Size = "none" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
type PaddingSize = Size | "xxxl";

type Align = "start" | "center" | "end" | "stretch" | "baseline";
type Justify = "start" | "center" | "end" | "between" | "around" | "evenly";
type Direction = "row" | "column" | "row-reverse" | "column-reverse";
type Overflow = "visible" | "hidden" | "auto" | "scroll";
type Position = "relative" | "absolute" | "fixed";

export interface PanelProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Flex direction. Default: "row" (CSS default). */
    direction?: Direction;
    /** Allow children to wrap. Default: false. */
    wrap?: boolean;

    /** Flex shorthand on self. `true` → "1 1 auto"; number → "<n> 1 auto"; string passes through. */
    flex?: boolean | number | string;
    /** Set `flex-shrink: 0` when `false`. Use for sidebars that must keep their fixed width. */
    shrink?: boolean;

    /** Uniform padding. Side-specific props win over `paddingX`/`paddingY` win over `padding`. */
    padding?: PaddingSize;
    paddingX?: PaddingSize;
    paddingY?: PaddingSize;
    paddingTop?: PaddingSize;
    paddingBottom?: PaddingSize;
    paddingLeft?: PaddingSize;
    paddingRight?: PaddingSize;

    /** Gap between children. */
    gap?: Size;

    /** align-items. */
    align?: Align;
    /** justify-content. */
    justify?: Justify;

    /** Fixed width/height in px (number) or any CSS length (string, e.g. "50%"). */
    width?: number | string;
    height?: number | string;
    /** Max width — number → px, string passes through (e.g. "100%"). */
    maxWidth?: number | string;
    /** Min width — number → px, string passes through. */
    minWidth?: number | string;
    /** Max height — number → px, string passes through. */
    maxHeight?: number | string;
    /** Min height — number → px, string passes through. */
    minHeight?: number | string;

    overflow?: Overflow;
    overflowX?: Overflow;
    overflowY?: Overflow;

    /** CSS position. Default: undefined (static). Use "relative" on parents of absolutely-positioned children. */
    position?: Position;
    /** CSS `inset` shorthand — number → px, string passes through. Sets all four sides at once. */
    inset?: number | string;
    /** Stack order. Use sparingly — overlays / popovers only. */
    zIndex?: number;
    /** CSS top — number → px, string passes through (e.g. "auto", "50%"). Use with `position` to anchor an edge. */
    top?: number | string;
    /** CSS right — number → px, string passes through. */
    right?: number | string;
    /** CSS bottom — number → px, string passes through. */
    bottom?: number | string;
    /** CSS left — number → px, string passes through. */
    left?: number | string;

    /** All four borders. */
    border?: boolean;
    borderTop?: boolean;
    borderBottom?: boolean;
    borderLeft?: boolean;
    borderRight?: boolean;
    /** Border color. Default: "subtle" (color.border.light). "default" uses color.border.default. */
    borderColor?: "subtle" | "default";

    /** Border radius from radius scale. */
    rounded?: Size;
    /** Drop shadow (Card-style elevation). */
    shadow?: boolean;
    /** Background fill. Maps to color.background.{default,light,dark,overlay}. */
    background?: "default" | "light" | "dark" | "overlay";

    /** Dim + disable pointer events on the whole panel. */
    disabled?: boolean;

    children?: React.ReactNode;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        boxSizing: "border-box",
        // flex-direction: row is the CSS default — no rule needed.

        '&[data-direction="column"]':         { flexDirection: "column" },
        '&[data-direction="row-reverse"]':    { flexDirection: "row-reverse" },
        '&[data-direction="column-reverse"]': { flexDirection: "column-reverse" },

        '&[data-bg="default"]': { backgroundColor: color.background.default },
        '&[data-bg="light"]':   { backgroundColor: color.background.light },
        '&[data-bg="dark"]':    { backgroundColor: color.background.dark },
        '&[data-bg="overlay"]': { backgroundColor: color.background.overlay },

        // --- Borders (subtle = color.border.light, default = color.border.default) ---
        "&[data-border]":        { border:       `1px solid ${color.border.light}` },
        "&[data-border-top]":    { borderTop:    `1px solid ${color.border.light}` },
        "&[data-border-bottom]": { borderBottom: `1px solid ${color.border.light}` },
        "&[data-border-left]":   { borderLeft:   `1px solid ${color.border.light}` },
        "&[data-border-right]":  { borderRight:  `1px solid ${color.border.light}` },

        '&[data-border-color="default"]':                          { borderColor: color.border.default },
        '&[data-border-color="default"][data-border-top]':         { borderTopColor: color.border.default },
        '&[data-border-color="default"][data-border-bottom]':      { borderBottomColor: color.border.default },
        '&[data-border-color="default"][data-border-left]':        { borderLeftColor: color.border.default },
        '&[data-border-color="default"][data-border-right]':       { borderRightColor: color.border.default },

        "&[data-shadow]": { boxShadow: `0 2px 8px ${color.shadow.default}` },

        "&[data-disabled]": {
            opacity: 0.6,
            pointerEvents: "none",
        },
    },
    { label: "Panel" },
);

// --- Token resolvers ---

const ALIGN_MAP: Record<Align, string> = {
    start: "flex-start",
    center: "center",
    end: "flex-end",
    stretch: "stretch",
    baseline: "baseline",
};

const JUSTIFY_MAP: Record<Justify, string> = {
    start: "flex-start",
    center: "center",
    end: "flex-end",
    between: "space-between",
    around: "space-around",
    evenly: "space-evenly",
};

function spaceVal(v?: PaddingSize): number | undefined {
    if (v === undefined) return undefined;
    if (v === "none") return 0;
    return spacing[v];
}

function gapVal(v?: Size): number | undefined {
    if (v === undefined) return undefined;
    if (v === "none") return 0;
    return gapTokens[v];
}

function radiusVal(v?: Size): number | string | undefined {
    if (v === undefined) return undefined;
    if (v === "none") return 0;
    return radius[v as keyof typeof radius];
}

function flexVal(v: PanelProps["flex"]): string | undefined {
    if (v === undefined || v === false) return undefined;
    if (v === true) return "1 1 auto";
    if (typeof v === "number") return `${v} 1 auto`;
    return v;
}

function isScrollable(v?: Overflow): boolean {
    return v === "auto" || v === "scroll";
}

// --- Component ---

export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(function Panel(
    props,
    ref,
) {
    const {
        direction = "row",
        wrap,
        flex,
        shrink,
        padding,
        paddingX,
        paddingY,
        paddingTop,
        paddingBottom,
        paddingLeft,
        paddingRight,
        gap: gapProp,
        align,
        justify,
        width,
        height,
        maxWidth,
        minWidth,
        maxHeight,
        minHeight,
        overflow,
        overflowX,
        overflowY,
        position,
        inset,
        zIndex,
        top,
        right,
        bottom,
        left,
        border,
        borderTop,
        borderBottom,
        borderLeft,
        borderRight,
        borderColor,
        rounded,
        shadow,
        background,
        disabled,
        children,
        ...rest
    } = props;

    // Padding specificity: side > axis > all
    const padTop    = paddingTop    ?? paddingY ?? padding;
    const padBottom = paddingBottom ?? paddingY ?? padding;
    const padLeft   = paddingLeft   ?? paddingX ?? padding;
    const padRight  = paddingRight  ?? paddingX ?? padding;

    const inlineStyle: React.CSSProperties = {
        flex: flexVal(flex),
        flexShrink: shrink === false ? 0 : undefined,
        flexWrap: wrap ? "wrap" : undefined,

        paddingTop: spaceVal(padTop),
        paddingBottom: spaceVal(padBottom),
        paddingLeft: spaceVal(padLeft),
        paddingRight: spaceVal(padRight),

        gap: gapVal(gapProp),

        alignItems: align ? ALIGN_MAP[align] : undefined,
        justifyContent: justify ? JUSTIFY_MAP[justify] : undefined,

        width,
        height,
        maxWidth,
        minWidth,
        maxHeight,
        minHeight,
        overflow,
        overflowX,
        overflowY,

        position,
        inset,
        zIndex,
        top,
        right,
        bottom,
        left,

        borderRadius: radiusVal(rounded),
    };

    const scrollable =
        isScrollable(overflow) || isScrollable(overflowX) || isScrollable(overflowY);

    return (
        <Root
            ref={ref}
            data-type="panel"
            data-direction={direction}
            data-bg={background || undefined}
            data-border={border || undefined}
            data-border-top={borderTop || undefined}
            data-border-bottom={borderBottom || undefined}
            data-border-left={borderLeft || undefined}
            data-border-right={borderRight || undefined}
            data-border-color={borderColor || undefined}
            data-shadow={shadow || undefined}
            data-disabled={disabled || undefined}
            className={scrollable ? "scroll-container" : undefined}
            {...rest}
            style={inlineStyle}
        >
            {children}
        </Root>
    );
});
