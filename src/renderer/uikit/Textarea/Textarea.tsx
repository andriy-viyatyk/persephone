import React from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { fontSize, radius, spacing } from "../tokens";

// --- Types ---

export interface TextareaProps
    extends Omit<
        React.HTMLAttributes<HTMLDivElement>,
        // Rule 7 — forbid style/className on UIKit components.
        | "style" | "className"
        // Reimplemented with a string-value API instead of an event API.
        | "onChange" | "onInput"
        // Owned by the component (single-line stripping, paste handling, contentEditable).
        | "onPaste" | "onKeyDown"
        | "contentEditable"
        // The component's content comes from `value`, not `children`.
        | "children"
        // Never makes sense on a contentEditable surface.
        | "dangerouslySetInnerHTML"
    > {
    /** Current text value. */
    value: string;
    /** Change handler — receives the string value directly, not the event. */
    onChange?: (value: string) => void;
    /** Empty-state placeholder text. */
    placeholder?: string;
    /** Disabled — non-editable, dimmed, no caret on click. */
    disabled?: boolean;
    /** Read-only — shows content, suppresses editing, NOT dimmed. */
    readOnly?: boolean;
    /** Single-line mode — Enter is suppressed; newlines in pasted text are stripped. Default: false. */
    singleLine?: boolean;
    /** Minimum height in px (the control reserves at least this much vertical space). */
    minHeight?: number;
    /** Maximum height in px before vertical scrolling kicks in. */
    maxHeight?: number;
    /** Size variant — controls font size. Default: "md". */
    size?: "sm" | "md";
    /** Auto-focus on mount. Default: false. */
    autoFocus?: boolean;
}

/** Imperative handle exposed via `ref`. */
export interface TextareaRef {
    focus: () => void;
    clear: () => void;
    getText: () => string;
}

// --- Helpers ---

function innerTextToString(text: string): string {
    if (text === "\n") return "";
    if (text.endsWith("\n")) return text.slice(0, -1);
    return text;
}

// --- Styled ---

const Root = styled.div(
    {
        padding: `${spacing.sm}px ${spacing.md}px`,
        backgroundColor: color.background.dark,
        color: color.text.dark,
        border: `1px solid ${color.border.light}`,
        borderRadius: radius.md,
        outline: "none",
        boxSizing: "border-box",
        whiteSpace: "pre-wrap",
        overflowY: "auto",

        '&[data-size="sm"]': { fontSize: fontSize.sm },
        '&[data-size="md"]': { fontSize: fontSize.base },

        "&:focus, &:active": {
            borderColor: color.border.active,
        },
        "&[data-readonly]:focus, &[data-readonly]:active": {
            borderColor: color.border.light,
        },

        "&:empty::before": {
            content: "attr(data-placeholder)",
            color: color.text.light,
            pointerEvents: "none",
        },

        "&[data-disabled]": {
            opacity: 0.5,
            pointerEvents: "none",
        },
    },
    { label: "Textarea" },
);

// --- Component ---

export const Textarea = React.forwardRef<TextareaRef, TextareaProps>(
    function Textarea(props, ref) {
        const {
            value,
            onChange,
            placeholder,
            disabled,
            readOnly,
            singleLine,
            minHeight,
            maxHeight,
            size = "md",
            autoFocus,
            ...rest
        } = props;
        const divRef = React.useRef<HTMLDivElement>(null);
        const editable = !disabled && !readOnly;

        React.useEffect(() => {
            const el = divRef.current;
            if (el && innerTextToString(el.innerText) !== value) {
                el.innerText = value ?? "";
            }
        }, [value]);

        React.useEffect(() => {
            if (autoFocus) {
                const id = setTimeout(() => divRef.current?.focus(), 0);
                return () => clearTimeout(id);
            }
        }, [autoFocus]);

        React.useImperativeHandle(ref, () => ({
            focus: () => divRef.current?.focus(),
            clear: () => {
                if (divRef.current) {
                    divRef.current.innerText = "";
                    onChange?.("");
                }
            },
            getText: () => innerTextToString(divRef.current?.innerText ?? ""),
        }));

        const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
            let text = e.currentTarget.innerText;
            if (singleLine && text.includes("\n")) {
                text = text.replace(/\n/g, "");
                e.currentTarget.innerText = text;
            } else {
                text = innerTextToString(text);
            }
            onChange?.(text);
        };

        const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
            e.preventDefault();
            let text = e.clipboardData.getData("text/plain");
            if (singleLine) text = text.replace(/\n/g, "");

            const sel = window.getSelection();
            if (!sel?.rangeCount) return;
            sel.deleteFromDocument();
            const node = document.createTextNode(text);
            sel.getRangeAt(0).insertNode(node);
            const range = document.createRange();
            range.setStartAfter(node);
            range.setEndAfter(node);
            sel.removeAllRanges();
            sel.addRange(range);

            onChange?.(innerTextToString(divRef.current?.innerText ?? ""));
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (singleLine && e.key === "Enter") e.preventDefault();
        };

        const style: React.CSSProperties = {};
        if (minHeight !== undefined) style.minHeight = minHeight;
        if (maxHeight !== undefined) style.maxHeight = maxHeight;

        return (
            <Root
                ref={divRef}
                {...rest}
                role="textbox"
                aria-multiline={!singleLine}
                contentEditable={editable ? "plaintext-only" : false}
                spellCheck={false}
                data-type="textarea"
                data-size={size}
                data-disabled={disabled || undefined}
                data-readonly={readOnly || undefined}
                data-single-line={singleLine || undefined}
                data-placeholder={placeholder}
                onInput={editable ? handleInput : undefined}
                onPaste={editable ? handlePaste : undefined}
                onKeyDown={editable ? handleKeyDown : undefined}
                tabIndex={editable ? 0 : -1}
                style={style}
            />
        );
    },
);
