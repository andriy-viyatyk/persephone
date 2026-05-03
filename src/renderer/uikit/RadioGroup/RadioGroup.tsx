import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, gap as gapTokens, height, spacing } from "../tokens";
import { RadioCheckedIcon, RadioUncheckedIcon } from "../../theme/icons";
import {
    isTraited,
    resolveTraited,
    TraitKey,
    Traited,
    TraitType,
} from "../../core/traits/traits";

// --- Types ---

export interface IRadio {
    /** Stable identifier — what `value` / `onChange` refer to. */
    value: string;
    /** Display label. Falls back to `value` when omitted. */
    label?: React.ReactNode;
    /** Icon rendered between the radio circle and the label. */
    icon?: React.ReactNode;
    /** Disables this option without affecting siblings. */
    disabled?: boolean;
}

/** Trait key for non-IRadio item arrays — register accessors against this. */
export const RADIO_KEY = new TraitKey<TraitType<IRadio>>("radio-group-item");

type GapSize = "xs" | "sm" | "md" | "lg" | "xl";
type Orientation = "horizontal" | "vertical";

export interface RadioGroupProps {
    items: IRadio[] | Traited<unknown[]>;
    value: string;
    onChange: (value: string) => void;
    /** Layout direction. Default: "vertical". */
    orientation?: Orientation;
    /** Allow wrapping when `orientation="horizontal"`. Default: false. */
    wrap?: boolean;
    /** Gap between items. Default: "sm". */
    gap?: GapSize;
    /** Disables the entire group. Per-item disabling is on `IRadio.disabled`. */
    disabled?: boolean;
    "aria-label"?: string;
    "aria-labelledby"?: string;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "inline-flex",
        '&[data-orientation="horizontal"]': { flexDirection: "row" },
        '&[data-orientation="vertical"]':   { flexDirection: "column" },
        "&[data-disabled]": { opacity: 0.6 },
    },
    { label: "RadioGroup" },
);

const Item = styled.button(
    {
        display: "inline-flex",
        alignItems: "center",
        gap: spacing.sm,
        padding: `${spacing.xs}px ${spacing.sm}px`,
        margin: 0,
        border: "none",
        background: "transparent",
        outline: "none",
        cursor: "pointer",
        color: color.text.default,
        fontSize: fontSize.base,
        fontFamily: "inherit",
        textAlign: "left",

        "& .radio-icon": {
            flexShrink: 0,
            width: height.iconMd,
            height: height.iconMd,
            color: color.text.light,
        },

        "& .item-icon": {
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
        },
        "& .item-icon > svg": {
            width: height.iconMd,
            height: height.iconMd,
        },

        "&:hover .radio-icon, &:focus-visible .radio-icon": {
            color: color.text.default,
        },

        '&[data-checked="true"] .radio-icon': {
            color: color.text.default,
        },

        "&[data-disabled]": {
            cursor: "default",
            opacity: 0.5,
        },
        "&[data-disabled]:hover .radio-icon": {
            color: color.text.light,
        },
    },
    { label: "RadioGroupItem" },
);

// --- Component ---

export function RadioGroup({
    items,
    value,
    onChange,
    orientation = "vertical",
    wrap = false,
    gap = "sm",
    disabled,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
}: RadioGroupProps) {
    const radios = isTraited<unknown[]>(items)
        ? resolveTraited<IRadio>(items, RADIO_KEY)
        : items;
    const rootRef = React.useRef<HTMLDivElement>(null);

    // Roving tabindex: only one item is in the tab sequence. Prefer the
    // selected item; if no item matches `value`, fall back to the first
    // non-disabled item so the group remains tab-reachable.
    const selectedIdx = radios.findIndex((r) => r.value === value && !r.disabled);
    const fallbackIdx = selectedIdx >= 0
        ? selectedIdx
        : radios.findIndex((r) => !r.disabled);

    const focusItem = (i: number) => {
        const btn = rootRef.current?.children[i] as HTMLElement | undefined;
        btn?.focus();
    };

    const moveFocus = (currentIdx: number, dir: 1 | -1) => {
        const n = radios.length;
        if (n === 0) return;
        let next = currentIdx;
        for (let step = 0; step < n; step++) {
            next = (next + dir + n) % n;
            if (!radios[next].disabled) {
                focusItem(next);
                onChange(radios[next].value);
                return;
            }
        }
    };

    const handleKey = (e: React.KeyboardEvent, i: number) => {
        switch (e.key) {
            case "ArrowRight":
            case "ArrowDown":
                e.preventDefault();
                e.stopPropagation();
                moveFocus(i, 1);
                break;
            case "ArrowLeft":
            case "ArrowUp":
                e.preventDefault();
                e.stopPropagation();
                moveFocus(i, -1);
                break;
            case "Home": {
                e.preventDefault();
                e.stopPropagation();
                const first = radios.findIndex((r) => !r.disabled);
                if (first >= 0) {
                    focusItem(first);
                    onChange(radios[first].value);
                }
                break;
            }
            case "End": {
                e.preventDefault();
                e.stopPropagation();
                for (let j = radios.length - 1; j >= 0; j--) {
                    if (!radios[j].disabled) {
                        focusItem(j);
                        onChange(radios[j].value);
                        break;
                    }
                }
                break;
            }
            case " ":
            case "Enter": {
                e.preventDefault();
                e.stopPropagation();
                const r = radios[i];
                if (r && !r.disabled) onChange(r.value);
                break;
            }
        }
    };

    return (
        <Root
            ref={rootRef}
            role="radiogroup"
            data-type="radio-group"
            data-orientation={orientation}
            data-disabled={disabled || undefined}
            data-roving-host=""
            aria-disabled={disabled || undefined}
            aria-orientation={orientation}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            style={{
                gap: gapTokens[gap],
                flexWrap: orientation === "horizontal" && wrap ? "wrap" : undefined,
            }}
        >
            {radios.map((radio, i) => {
                const selected = radio.value === value;
                const itemDisabled = disabled || radio.disabled;
                return (
                    <Item
                        key={radio.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-disabled={itemDisabled || undefined}
                        data-type="radio"
                        data-checked={selected ? "true" : "false"}
                        data-disabled={itemDisabled || undefined}
                        disabled={itemDisabled}
                        tabIndex={i === fallbackIdx ? 0 : -1}
                        onClick={() => onChange(radio.value)}
                        onKeyDown={(e) => handleKey(e, i)}
                    >
                        {selected
                            ? <RadioCheckedIcon className="radio-icon" />
                            : <RadioUncheckedIcon className="radio-icon" />}
                        {radio.icon && <span className="item-icon">{radio.icon}</span>}
                        {radio.label ?? radio.value}
                    </Item>
                );
            })}
        </Root>
    );
}
