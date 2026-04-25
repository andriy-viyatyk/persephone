import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { gap, spacing } from "../tokens";

// --- Types ---

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
    orientation?: "horizontal" | "vertical";
    background?: "default" | "light" | "dark";
    borderTop?: boolean;
    borderBottom?: boolean;
    disabled?: boolean;
    "aria-label"?: string;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        alignItems: "center",
        columnGap: gap.sm,
        flexWrap: "nowrap",
        overflow: "hidden",
        flexShrink: 0,
        padding: `${spacing.xs}px ${spacing.sm}px`,

        // Empty toolbars collapse — preserves the historical PageToolbar behavior.
        "&:empty": { display: "none" },

        '&[data-bg="default"]': { backgroundColor: color.background.default },
        '&[data-bg="light"]':   { backgroundColor: color.background.light },
        '&[data-bg="dark"]':    { backgroundColor: color.background.dark },

        '&[data-orientation="vertical"]': {
            flexDirection: "column",
            alignItems: "stretch",
            columnGap: 0,
            rowGap: gap.sm,
            padding: `${spacing.sm}px ${spacing.xs}px`,
        },

        "&[data-border-top]":    { borderTop:    `1px solid ${color.border.light}` },
        "&[data-border-bottom]": { borderBottom: `1px solid ${color.border.light}` },

        "&[data-disabled]": {
            opacity: 0.6,
            pointerEvents: "none",
        },
    },
    { label: "Toolbar" },
);

// --- Roving tabindex helper (Rule 4) ---

function findFocusable(el: Element): HTMLElement | null {
    const candidates = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]',
    );
    const all = el.matches('button,input,select,textarea,a[href],[tabindex]')
        ? [el as HTMLElement, ...Array.from(candidates)]
        : Array.from(candidates);
    for (const c of all) {
        if (c.hasAttribute("disabled")) continue;
        const ti = c.getAttribute("tabindex");
        if (ti === "-1" && !c.hasAttribute("data-roving-host")) continue;
        return c;
    }
    return null;
}

function useRovingTabIndex(
    rootRef: React.RefObject<HTMLDivElement | null>,
    orientation: "horizontal" | "vertical",
    disabled: boolean | undefined,
) {
    const [activeIdx, setActiveIdx] = React.useState(0);

    const collectStops = React.useCallback((): HTMLElement[] => {
        const root = rootRef.current;
        if (!root) return [];
        const stops: HTMLElement[] = [];
        for (const child of Array.from(root.children)) {
            // If this child is or contains a nested roving widget, treat the
            // widget as one tab stop. The widget owns its own internal arrow-
            // key handling once focus is inside.
            const host = child.hasAttribute("data-roving-host")
                ? (child as HTMLElement)
                : child.querySelector<HTMLElement>("[data-roving-host]");
            if (host) {
                const inner = host.querySelector<HTMLElement>('[tabindex="0"]')
                    ?? findFocusable(host);
                if (inner) stops.push(inner);
                continue;
            }
            const f = findFocusable(child);
            if (f) stops.push(f);
        }
        return stops;
    }, [rootRef]);

    React.useLayoutEffect(() => {
        if (disabled) {
            for (const s of collectStops()) s.tabIndex = -1;
            return;
        }
        const stops = collectStops();
        if (stops.length === 0) return;
        const idx = Math.min(activeIdx, stops.length - 1);
        stops.forEach((s, i) => { s.tabIndex = i === idx ? 0 : -1; });
    });

    const move = (dir: 1 | -1) => {
        const stops = collectStops();
        const n = stops.length;
        if (n === 0) return;
        let next = activeIdx;
        for (let step = 0; step < n; step++) {
            next = (next + dir + n) % n;
            if (!stops[next].hasAttribute("disabled")) {
                stops[next].focus();
                setActiveIdx(next);
                return;
            }
        }
    };

    const jump = (target: "first" | "last") => {
        const stops = collectStops();
        const n = stops.length;
        if (n === 0) return;
        const range = target === "first"
            ? Array.from({ length: n }, (_, i) => i)
            : Array.from({ length: n }, (_, i) => n - 1 - i);
        for (const i of range) {
            if (!stops[i].hasAttribute("disabled")) {
                stops[i].focus();
                setActiveIdx(i);
                return;
            }
        }
    };

    const handleKey = (e: React.KeyboardEvent) => {
        const target = e.target as HTMLElement;
        const root = rootRef.current;
        if (!root) return;
        // Keys originating inside a nested roving widget are owned by it.
        const host = target.closest("[data-roving-host]");
        if (host && host !== root && root.contains(host)) return;

        const fwd = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
        const back = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
        switch (e.key) {
            case fwd:  e.preventDefault(); move(1);  break;
            case back: e.preventDefault(); move(-1); break;
            case "Home": e.preventDefault(); jump("first"); break;
            case "End":  e.preventDefault(); jump("last");  break;
        }
    };

    const handleFocusCapture = (e: React.FocusEvent) => {
        const stops = collectStops();
        const idx = stops.findIndex((s) => s === e.target || s.contains(e.target as Node));
        if (idx >= 0) setActiveIdx(idx);
    };

    return { handleKey, handleFocusCapture };
}

// --- Component ---

export function Toolbar({
    orientation = "horizontal",
    background = "dark",
    borderTop,
    borderBottom,
    disabled,
    children,
    onKeyDown,
    onFocusCapture,
    ...rest
}: ToolbarProps) {
    const rootRef = React.useRef<HTMLDivElement>(null);
    const { handleKey, handleFocusCapture } = useRovingTabIndex(
        rootRef,
        orientation,
        disabled,
    );

    return (
        <Root
            ref={rootRef}
            role="toolbar"
            aria-orientation={orientation}
            aria-disabled={disabled || undefined}
            data-type="toolbar"
            data-roving-host=""
            data-orientation={orientation}
            data-bg={background}
            data-border-top={borderTop || undefined}
            data-border-bottom={borderBottom || undefined}
            data-disabled={disabled || undefined}
            onKeyDown={(e) => { handleKey(e); onKeyDown?.(e); }}
            onFocusCapture={(e) => { handleFocusCapture(e); onFocusCapture?.(e); }}
            {...rest}
        >
            {children}
        </Root>
    );
}
