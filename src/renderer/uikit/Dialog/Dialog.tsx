import React, { useCallback, useLayoutEffect, useRef } from "react";
import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";
import color from "../../theme/color";
import { radius } from "../tokens";

// --- Types ---

export type DialogPosition = "center" | "right";

export interface DialogProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    /** Where to anchor the dialog body. Default: "center". */
    position?: DialogPosition;
    /** Click on the backdrop (outside the dialog body). */
    onBackdropClick?: () => void;
    /** Auto-focus the first focusable child on mount. Default: true. */
    autoFocus?: boolean;
    children?: React.ReactNode;
}

// --- Styled ---

const pulse = keyframes`
  0% { transform: scale(0.9); }
  100% { transform: scale(1); }
`;

const Root = styled.div(
    {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 100,
        background: "transparent",
        animation: `${pulse} 0.1s ease-out`,
        outline: "none",

        '&[data-position="center"]': {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            "& > [data-type='dialog-content']": {
                border: `1px solid ${color.border.default}`,
                borderRadius: radius.lg,
                boxShadow: color.shadow.default,
            },
        },

        '&[data-position="right"]': {
            "& > [data-type='dialog-content']": {
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                minWidth: 200,
                borderLeft: `1px solid ${color.border.default}`,
            },
        },
    },
    { label: "Dialog" },
);

// --- Focus trap ---

const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']",
].join(",");

function getFocusable(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
    );
}

// --- Component ---

export function Dialog({
    position = "center",
    onBackdropClick,
    autoFocus = true,
    onKeyDown,
    onClick,
    children,
    ...rest
}: DialogProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useLayoutEffect(() => {
        previousFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;

        const root = rootRef.current;
        if (!root) return;

        if (autoFocus) {
            const focusables = getFocusable(root);
            if (focusables.length > 0) {
                focusables[0].focus();
            } else {
                root.focus();
            }
        }

        return () => {
            const prev = previousFocusRef.current;
            if (prev && document.contains(prev)) {
                prev.focus();
            }
        };
    }, [autoFocus]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            if (e.key !== "Tab") return;

            const root = rootRef.current;
            if (!root) return;

            const focusables = getFocusable(root);
            if (focusables.length === 0) {
                e.preventDefault();
                root.focus();
                return;
            }

            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement as HTMLElement | null;

            if (e.shiftKey) {
                if (active === first || !root.contains(active)) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (active === last || !root.contains(active)) {
                    e.preventDefault();
                    first.focus();
                }
            }
        },
        [onKeyDown],
    );

    const handleClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            onClick?.(e);
            if (e.defaultPrevented) return;
            if (e.target === e.currentTarget) {
                onBackdropClick?.();
            }
        },
        [onClick, onBackdropClick],
    );

    return (
        <Root
            ref={rootRef}
            data-type="dialog"
            data-position={position}
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            onClick={handleClick}
            {...rest}
        >
            {children}
        </Root>
    );
}
