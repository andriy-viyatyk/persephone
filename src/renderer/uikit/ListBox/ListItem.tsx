import React, { forwardRef } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { gap, height, spacing } from "../tokens";
import { CheckIcon, ChevronRightIcon } from "../../theme/icons";
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
    /**
     * How the selected state is rendered.
     *   • `"check"` (default) — trailing check icon (when no custom `trailing` is set).
     *   • `"accent"` — filled selection background + trailing chevron-right icon.
     *     Use for sidebar/browse lists where selection is persistent navigation
     *     state and the selected row's details are shown to the right.
     */
    selectionStyle?: "check" | "accent";
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
        '&[data-variant="select"][data-active], &[data-variant="select"]:hover': {
            backgroundColor: color.background.selection,
            color: color.text.selection,
        },
        '&[data-variant="browse"][data-active], &[data-variant="browse"]:hover': {
            backgroundColor: color.background.message,
        },
        '&[data-selection-style="accent"][data-selected]': {
            backgroundColor: color.background.selection,
            color: color.text.selection,
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
        selectionStyle = "check",
        ...rest
    },
    ref,
) {
    const labelNode =
        typeof label === "string" && searchText ? highlight(label, searchText) : label;
    const defaultTrailing = selected
        ? selectionStyle === "accent"
            ? <ChevronRightIcon />
            : <CheckIcon />
        : null;
    const row = (
        <Root
            ref={ref}
            id={id}
            data-type="list-item"
            data-variant={variant}
            data-selection-style={selectionStyle}
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
            {trailing ?? defaultTrailing}
        </Root>
    );
    if (tooltip == null || tooltip === false || tooltip === "") return row;
    return <Tooltip content={tooltip}>{row}</Tooltip>;
});
