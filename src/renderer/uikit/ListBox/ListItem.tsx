import React, { forwardRef } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { gap, height, spacing } from "../tokens";
import { CheckIcon } from "../../theme/icons";
import { highlight } from "../shared/highlight";
import { Tooltip } from "../Tooltip";

// --- Types ---

export interface ListItemProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Stable id used for `aria-activedescendant` wiring. */
    id?: string;
    /** Leading icon. */
    icon?: React.ReactNode;
    /** Label content. When `searchText` is provided, plain-string labels are highlighted. */
    label: React.ReactNode;
    /** Highlight matches in the label. Only applied when `label` is a string. */
    searchText?: string;
    /** True when this item is the current `value` of its ListBox. */
    selected?: boolean;
    /** True when this item is the current `activeIndex` of its ListBox. */
    active?: boolean;
    /** True when this item should not respond to clicks. */
    disabled?: boolean;
    /**
     * Tooltip body shown after the standard hover delay. When `null`, `undefined`, `false`,
     * or empty string, no tooltip is rendered.
     */
    tooltip?: React.ReactNode;
    /** Trailing slot — defaults to a check icon when `selected`. */
    trailing?: React.ReactNode;
    /**
     * Visual style.
     *   • `"select"` (default) — strong selection-style highlight on hover/active.
     *     Matches Select dropdowns and menus where selection feedback should be loud.
     *   • `"browse"` — soft hover background (no text-color change). Matches the
     *     legacy folder tree feel; use for sidebar / browse-style lists where hover
     *     is purely a navigation cue.
     */
    variant?: "select" | "browse";
}

// --- Styled ---

const Root = styled.div(
    {
        display: "inline-flex",
        width: "100%",
        boxSizing: "border-box",
        alignItems: "center",
        gap: gap.md,
        paddingLeft: spacing.sm,
        paddingRight: spacing.sm,
        cursor: "pointer",
        color: color.text.default,
        overflow: "hidden",

        "&[data-disabled]": { opacity: 0.4, pointerEvents: "none" },
        '&[data-variant="select"][data-active]': {
            backgroundColor: color.background.selection,
            color: color.text.selection,
        },
        '&[data-variant="browse"][data-active]': {
            backgroundColor: color.background.message,
        },

        "& > svg": {
            width: height.iconMd,
            height: height.iconMd,
            flexShrink: 0,
        },

        "& > .label": {
            flex: "1 1 auto",
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
    },
    { label: "ListItem" },
);

// --- Component ---

export const ListItem = forwardRef<HTMLDivElement, ListItemProps>(function ListItem(
    {
        id,
        icon,
        label,
        searchText,
        selected,
        active,
        disabled,
        tooltip,
        trailing,
        variant = "select",
        ...rest
    },
    ref,
) {
    const labelNode =
        typeof label === "string" && searchText ? highlight(label, searchText) : label;
    const row = (
        <Root
            ref={ref}
            id={id}
            data-type="list-item"
            data-variant={variant}
            data-selected={selected || undefined}
            data-active={active || undefined}
            data-disabled={disabled || undefined}
            role="option"
            aria-selected={selected ? "true" : "false"}
            aria-disabled={disabled ? "true" : undefined}
            {...rest}
        >
            {icon}
            <span className="label">{labelNode}</span>
            {trailing ?? (selected ? <CheckIcon /> : null)}
        </Root>
    );
    if (tooltip == null || tooltip === false || tooltip === "") return row;
    return <Tooltip content={tooltip}>{row}</Tooltip>;
});
