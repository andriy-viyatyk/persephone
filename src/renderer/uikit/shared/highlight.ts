import React, { createContext, useContext } from "react";

// =============================================================================
// Highlight Context — shares the active search text with descendant views.
// =============================================================================

const HighlightedTextContext = createContext<string | undefined>(undefined);

/** Wrap a subtree to make `value` available to `useHighlightedText()` below. */
export const HighlightedTextProvider = HighlightedTextContext.Provider;

/** Read the current Provider's `value`. Returns `undefined` outside a Provider. */
export function useHighlightedText(): string | undefined {
    return useContext(HighlightedTextContext);
}

/**
 * Split `text` on whitespace-separated tokens of `searchText`, recursively, returning
 * a flat array of React nodes where matches are wrapped in <strong>. Pure function —
 * no Context, no state. When `searchText` is empty or null, returns the raw text.
 */
export function highlight(text: string, searchText: string | null | undefined): React.ReactNode {
    if (!searchText) return text;
    const tokens = searchText.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (tokens.length === 0) return text;
    return highlightRecursive(text, tokens, 0);
}

function highlightRecursive(text: string, tokens: string[], keyBase: number): React.ReactNode {
    if (tokens.length === 0) return text;
    const [head, ...rest] = tokens;
    const escaped = head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expr = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(expr);
    return parts.map((part, i) => {
        const key = `${keyBase}-${i}`;
        if (part.toLowerCase() === head.toLowerCase()) {
            return React.createElement("strong", { key }, part);
        }
        return React.createElement(
            React.Fragment,
            { key },
            highlightRecursive(part, rest, i),
        );
    });
}
