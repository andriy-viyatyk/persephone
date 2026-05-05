import React from "react";
import { TComponentModel } from "../../core/state/model";
import { exceedsMaxDepth, getPathSuggestions, PathSuggestion } from "./suggestions";

// =============================================================================
// Props
// =============================================================================

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

// =============================================================================
// State
// =============================================================================

export interface PathInputState {
    open: boolean;
    activeIndex: number | null;
}

export const defaultPathInputState: PathInputState = {
    open: false,
    activeIndex: null,
};

// =============================================================================
// Model
// =============================================================================

export class PathInputModel extends TComponentModel<PathInputState, PathInputProps> {
    // --- refs (DOM) ---
    inputRef: HTMLInputElement | null = null;
    rowRefs: Array<HTMLDivElement | null> = [];

    setInputRef = (el: HTMLInputElement | null) => {
        this.inputRef = el;
    };

    setRowRef = (idx: number, el: HTMLDivElement | null) => {
        this.rowRefs[idx] = el;
    };

    // --- internal flags (not state — flipping them must not re-render) ---
    private selectionMade = false;
    private escapeCancelled = false;

    // --- derived ---

    suggestions = this.memo<PathSuggestion[]>(
        () => {
            const { value, paths, separator = "/", maxDepth } = this.props;
            if (exceedsMaxDepth(value, separator, maxDepth)) return [];
            return getPathSuggestions(value, paths, separator);
        },
        () => [
            this.props.value,
            this.props.paths,
            this.props.separator,
            this.props.maxDepth,
        ],
    );

    // --- handlers ---

    selectSuggestion = (s: PathSuggestion) => {
        const sep = this.props.separator ?? "/";
        if (s.isFolder) {
            this.props.onChange(s.path + sep);
            this.inputRef?.focus();
        } else {
            this.selectionMade = true;
            this.props.onChange(s.path);
            this.state.update((st) => {
                st.open = false;
            });
            this.props.onBlur?.(s.path);
        }
    };

    onInputChange = (v: string) => {
        this.props.onChange(v);
        if (!this.props.disabled && !this.props.readOnly && !this.state.get().open) {
            this.state.update((s) => {
                s.open = true;
            });
        }
    };

    onInputFocus = () => {
        if (!this.props.disabled && !this.props.readOnly) {
            this.state.update((s) => {
                s.open = true;
            });
        }
    };

    onInputBlur = () => {
        // 150ms grace so suggestion-row mouse clicks (and the Tab fall-through)
        // get a chance to set selectionMade before the commit fires.
        setTimeout(() => {
            if (this.selectionMade || this.escapeCancelled) {
                this.selectionMade = false;
                this.escapeCancelled = false;
                return;
            }
            if (!this.inputRef?.contains(document.activeElement)) {
                this.state.update((s) => {
                    s.open = false;
                });
                this.props.onBlur?.(this.props.value);
            }
        }, 150);
    };

    onRowMouseDown = (e: React.MouseEvent) => {
        // Prevent the input from losing focus when a row is clicked.
        e.preventDefault();
    };

    onRowClick = (s: PathSuggestion) => {
        this.selectSuggestion(s);
    };

    onRowMouseEnter = (i: number) => {
        this.state.update((s) => {
            s.activeIndex = i;
        });
    };

    onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const { open, activeIndex } = this.state.get();
        const { disabled, readOnly, value } = this.props;
        const sep = this.props.separator ?? "/";

        if (!open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!disabled && !readOnly) {
                    this.state.update((s) => {
                        s.open = true;
                    });
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                this.escapeCancelled = true;
                this.inputRef?.blur();
                this.props.onBlur?.(undefined);
            }
            return;
        }

        const suggestions = this.suggestions.value;
        const n = suggestions.length;
        switch (e.key) {
            case "ArrowDown": {
                e.preventDefault();
                if (n === 0) break;
                this.state.update((s) => {
                    if (s.activeIndex == null || s.activeIndex < 0) s.activeIndex = 0;
                    else s.activeIndex = s.activeIndex < n - 1 ? s.activeIndex + 1 : 0;
                });
                break;
            }
            case "ArrowUp": {
                e.preventDefault();
                if (n === 0) break;
                this.state.update((s) => {
                    if (s.activeIndex == null || s.activeIndex <= 0) s.activeIndex = n - 1;
                    else s.activeIndex -= 1;
                });
                break;
            }
            case "Enter": {
                e.preventDefault();
                if (activeIndex != null && activeIndex >= 0 && suggestions[activeIndex]) {
                    this.selectSuggestion(suggestions[activeIndex]);
                } else if (value !== "" && !value.endsWith(sep)) {
                    this.selectionMade = true;
                    this.state.update((s) => {
                        s.open = false;
                    });
                    this.props.onBlur?.(value);
                }
                break;
            }
            case "Tab": {
                if (activeIndex != null && activeIndex >= 0 && suggestions[activeIndex]) {
                    e.preventDefault();
                    this.selectSuggestion(suggestions[activeIndex]);
                }
                break;
            }
            case "Escape": {
                e.preventDefault();
                this.state.update((s) => {
                    s.open = false;
                });
                break;
            }
        }
    };

    onPopoverClose = () => {
        this.state.update((s) => {
            s.open = false;
        });
    };

    // --- lifecycle ---

    init() {
        // Keep the row-ref array sized to the current suggestion list so stale entries
        // don't pin removed nodes.
        this.effect(
            () => {
                this.rowRefs.length = this.suggestions.value.length;
            },
            () => [this.suggestions.value],
        );

        // Reset highlight whenever the suggestion list changes — same behavior as the
        // original `useEffect(() => setActiveIndex(null), [suggestions])`.
        this.effect(
            () => {
                this.state.update((s) => {
                    s.activeIndex = null;
                });
            },
            () => [this.suggestions.value],
        );

        // Scroll the active row into view when it changes.
        this.effect(
            () => {
                const idx = this.state.get().activeIndex;
                if (idx != null && idx >= 0) {
                    this.rowRefs[idx]?.scrollIntoView({ block: "nearest" });
                }
            },
            () => [this.state.get().activeIndex],
        );

        // autoFocus: place caret at end of value after the native focus fires on mount.
        this.effect(() => {
            if (this.props.autoFocus && this.inputRef) {
                const len = this.inputRef.value.length;
                this.inputRef.setSelectionRange(len, len);
            }
        });
    }
}
