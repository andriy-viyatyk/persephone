import type { NativeHTMLAttributes } from "../shared/dom-props";

// =============================================================================
// Props
// =============================================================================

export interface PathInputOwnProps {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances of this primitive in DOM inspector output. Never used for styling. */
    name?: string;
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
// Props
// =============================================================================

export interface PathInputProps
    extends Omit<
        NativeHTMLAttributes<HTMLDivElement>,
        "style" | "className" | "onChange" | "onBlur"
    >, PathInputOwnProps {}
