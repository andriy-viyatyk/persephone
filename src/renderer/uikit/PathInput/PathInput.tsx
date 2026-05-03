import React, {
    forwardRef,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing } from "../tokens";
import { Input } from "../Input";
import { Popover } from "../Popover";
import { exceedsMaxDepth, getPathSuggestions, PathSuggestion } from "./suggestions";

// --- Types ---

export interface PathInputProps
    extends Omit<
        React.HTMLAttributes<HTMLDivElement>,
        "style" | "className" | "onChange" | "onBlur"
    > {
    /** Current path value. */
    value: string;
    /** Live-update handler — fires on every keystroke and on folder selection. */
    onChange: (value: string) => void;
    /** Available paths used to derive suggestions. */
    paths: string[];
    /** Path separator. Default: "/". */
    separator?: string;
    /** Placeholder shown when value is empty. */
    placeholder?: string;
    /**
     * Commit handler — fires once per edit session when the input commits or cancels.
     *   • leaf-selection: `finalValue = leaf path`
     *   • Enter on typed value: `finalValue = value`
     *   • blur: `finalValue = current value`
     *   • Escape (popover already closed) or Enter on empty/separator-trailing value: `finalValue = undefined`
     * Folder selection does NOT fire onBlur — the input keeps editing.
     */
    onBlur?: (finalValue?: string) => void;
    /** Auto-focus on mount with caret at end. Default: false. */
    autoFocus?: boolean;
    /**
     * Maximum number of separator-delimited segments. When the input has more
     * segments than this, suggestions are hidden.
     */
    maxDepth?: number;
    /** Disabled state — input cannot be focused, popover never opens. */
    disabled?: boolean;
    /** Read-only state — input is focusable, but typing/popover are blocked. */
    readOnly?: boolean;
    /** Control size. Default: "md". */
    size?: "sm" | "md";
    "aria-label"?: string;
    "aria-labelledby"?: string;
}

// --- Styled ---

const Root = styled.div(
    {
        display: "flex",
        width: "100%",
        minWidth: 0,
        "&[data-disabled]": { opacity: 0.5, pointerEvents: "none" },
    },
    { label: "PathInput" },
);

const SuggestionRow = styled.div(
    {
        display: "flex",
        alignItems: "center",
        gap: 0,
        height: 24,
        flexShrink: 0,
        paddingLeft: spacing.md,
        paddingRight: spacing.md,
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        color: color.text.default,
        "& [data-part='prefix']": { color: color.text.light },
        "& [data-part='separator']": { color: color.text.light },
        "&[data-active]": {
            backgroundColor: color.background.selection,
            color: color.text.selection,
            "& [data-part='prefix'], & [data-part='separator']": {
                color: color.text.strong,
            },
        },
    },
    { label: "PathInputSuggestionRow" },
);

// --- Component ---

export const PathInput = forwardRef<HTMLInputElement, PathInputProps>(function PathInput(
    {
        value,
        onChange,
        paths,
        separator = "/",
        placeholder,
        onBlur,
        autoFocus,
        maxDepth,
        disabled,
        readOnly,
        size = "md",
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
        ...rest
    },
    ref,
) {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const rowsRef = useRef<Array<HTMLDivElement | null>>([]);
    const selectionMadeRef = useRef(false);
    const escapeCancelledRef = useRef(false);

    const setInputRef = useCallback(
        (el: HTMLInputElement | null) => {
            inputRef.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
        },
        [ref],
    );

    const suggestions = useMemo<PathSuggestion[]>(() => {
        if (exceedsMaxDepth(value, separator, maxDepth)) return [];
        return getPathSuggestions(value, paths, separator);
    }, [value, paths, separator, maxDepth]);

    // Keep row refs sized to the suggestion list.
    useEffect(() => {
        rowsRef.current.length = suggestions.length;
    }, [suggestions.length]);

    // Reset highlight whenever the suggestion list changes.
    useEffect(() => {
        setActiveIndex(null);
    }, [suggestions]);

    // Scroll the active row into view (mouse hover or keyboard nav).
    useEffect(() => {
        if (activeIndex != null && activeIndex >= 0) {
            rowsRef.current[activeIndex]?.scrollIntoView({ block: "nearest" });
        }
    }, [activeIndex]);

    // autoFocus: place caret at end of value after the native focus fires on mount.
    useEffect(() => {
        if (autoFocus && inputRef.current) {
            const len = inputRef.current.value.length;
            inputRef.current.setSelectionRange(len, len);
        }
    }, [autoFocus]);

    const selectSuggestion = useCallback(
        (s: PathSuggestion) => {
            if (s.isFolder) {
                onChange(s.path + separator);
                inputRef.current?.focus();
            } else {
                selectionMadeRef.current = true;
                onChange(s.path);
                setOpen(false);
                onBlur?.(s.path);
            }
        },
        [onChange, onBlur, separator],
    );

    const onInputChange = useCallback(
        (v: string) => {
            onChange(v);
            if (!disabled && !readOnly && !open) setOpen(true);
        },
        [onChange, disabled, readOnly, open],
    );

    const onInputFocus = useCallback(() => {
        if (!disabled && !readOnly) setOpen(true);
    }, [disabled, readOnly]);

    const handleBlur = useCallback(() => {
        // 150ms grace so suggestion-row mouse clicks (and the Tab fall-through)
        // get a chance to set selectionMadeRef before the commit fires.
        setTimeout(() => {
            if (selectionMadeRef.current || escapeCancelledRef.current) {
                selectionMadeRef.current = false;
                escapeCancelledRef.current = false;
                return;
            }
            if (!inputRef.current?.contains(document.activeElement)) {
                setOpen(false);
                onBlur?.(value);
            }
        }, 150);
    }, [onBlur, value]);

    const onInputKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (!open) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    if (!disabled && !readOnly) setOpen(true);
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    escapeCancelledRef.current = true;
                    inputRef.current?.blur();
                    onBlur?.(undefined);
                }
                return;
            }

            const n = suggestions.length;
            switch (e.key) {
                case "ArrowDown": {
                    e.preventDefault();
                    if (n === 0) break;
                    setActiveIndex((cur) => {
                        if (cur == null || cur < 0) return 0;
                        return cur < n - 1 ? cur + 1 : 0;
                    });
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    if (n === 0) break;
                    setActiveIndex((cur) => {
                        if (cur == null || cur <= 0) return n - 1;
                        return cur - 1;
                    });
                    break;
                }
                case "Enter": {
                    e.preventDefault();
                    if (activeIndex != null && activeIndex >= 0 && suggestions[activeIndex]) {
                        selectSuggestion(suggestions[activeIndex]);
                    } else if (value !== "" && !value.endsWith(separator)) {
                        selectionMadeRef.current = true;
                        setOpen(false);
                        onBlur?.(value);
                    }
                    break;
                }
                case "Tab": {
                    if (activeIndex != null && activeIndex >= 0 && suggestions[activeIndex]) {
                        e.preventDefault();
                        selectSuggestion(suggestions[activeIndex]);
                    }
                    break;
                }
                case "Escape": {
                    e.preventDefault();
                    setOpen(false);
                    break;
                }
            }
        },
        [
            open,
            suggestions,
            activeIndex,
            value,
            separator,
            selectSuggestion,
            onBlur,
            disabled,
            readOnly,
        ],
    );

    return (
        <Root
            data-type="path-input"
            data-state={open ? "open" : "closed"}
            data-disabled={disabled || undefined}
            data-readonly={readOnly || undefined}
            {...rest}
        >
            <Input
                ref={setInputRef}
                size={size}
                value={value}
                onChange={onInputChange}
                placeholder={placeholder}
                disabled={disabled}
                readOnly={readOnly}
                autoFocus={autoFocus}
                onFocus={onInputFocus}
                onBlur={handleBlur}
                onKeyDown={onInputKeyDown}
                autoComplete="off"
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                aria-haspopup="listbox"
                aria-expanded={open && suggestions.length > 0}
            />
            <Popover
                open={open && suggestions.length > 0}
                onClose={() => setOpen(false)}
                elementRef={inputRef.current}
                placement="bottom-start"
                offset={[0, 2]}
                matchAnchorWidth
                maxHeight={240}
                outsideClickIgnoreSelector='[data-type="path-input"]'
                role="listbox"
            >
                {suggestions.map((s, i) => (
                    <SuggestionRow
                        key={s.path}
                        ref={(el) => {
                            rowsRef.current[i] = el;
                        }}
                        role="option"
                        data-active={activeIndex === i || undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectSuggestion(s)}
                        onMouseEnter={() => setActiveIndex(i)}
                    >
                        {s.matchPrefix && <span data-part="prefix">{s.matchPrefix}</span>}
                        <span data-part="segment">{s.label}</span>
                        {s.isFolder && <span data-part="separator">{separator}</span>}
                    </SuggestionRow>
                ))}
            </Popover>
        </Root>
    );
});
