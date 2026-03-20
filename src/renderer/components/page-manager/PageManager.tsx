import { useLayoutEffect, useRef, ReactNode } from "react";
import { createPortal } from "react-dom";

interface PageManagerProps {
    /** Unique IDs for each page/tab — must be stable across renders */
    pageIds: string[];
    /** ID of the currently active (visible) page */
    activeId: string;
    /** Render function — receives page ID, returns React element */
    renderPage: (id: string) => ReactNode;
    /** Optional CSS class for the container div */
    className?: string;
}

/**
 * Manages a set of page placeholders using imperative DOM operations
 * and React portals. Prevents DOM destruction/recreation when the page
 * list changes (items added, removed, or reordered), which is critical
 * for elements like <webview> or <iframe> that reload when reinserted.
 *
 * Each page gets a stable placeholder div that is never moved in the DOM.
 * React content is rendered into each placeholder via createPortal().
 * Visibility is controlled via display:none on inactive placeholders.
 */
export function PageManager({ pageIds, activeId, renderPage, className }: PageManagerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const placeholdersRef = useRef(new Map<string, HTMLDivElement>());

    // Create placeholders for new IDs eagerly during render so they
    // exist when createPortal runs. Append to DOM in useLayoutEffect.
    const placeholders = placeholdersRef.current;
    for (const id of pageIds) {
        if (!placeholders.has(id)) {
            const el = document.createElement("div");
            el.style.position = "absolute";
            el.style.inset = "0";
            el.style.display = "none";
            placeholders.set(id, el);
        }
    }

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const currentIds = new Set(pageIds);

        // Remove placeholders for IDs that no longer exist
        for (const [id, el] of placeholders) {
            if (!currentIds.has(id)) {
                if (el.parentNode) container.removeChild(el);
                placeholders.delete(id);
            }
        }

        // Append new placeholders that aren't in the DOM yet
        for (const id of pageIds) {
            const el = placeholders.get(id);
            if (el && !el.parentNode) {
                container.appendChild(el);
            }
        }

        // Update visibility
        for (const [id, el] of placeholders) {
            el.style.display = id === activeId ? "" : "none";
        }
    }, [pageIds, activeId, placeholders]);

    return (
        <>
            <div ref={containerRef} className={className} />
            {pageIds.map((id) => {
                const placeholder = placeholders.get(id);
                return placeholder
                    ? createPortal(renderPage(id), placeholder, id)
                    : null;
            })}
        </>
    );
}
