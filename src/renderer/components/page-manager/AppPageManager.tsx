import { useLayoutEffect, useRef, ReactNode } from "react";
import { createPortal } from "react-dom";
import { GroupContainer } from "./GroupContainer";

interface AppPageManagerProps {
    /** All page IDs in display order */
    pageIds: string[];
    /** Active page ID */
    activeId: string;
    /** Grouped page ID (the partner of the active page, if grouped) */
    groupedActiveId?: string;
    /** Grouping map: left page ID → right page ID */
    grouping: Map<string, string>;
    /** Set of left page IDs in compare mode — hides splitter and right placeholder */
    compareModeIds?: Set<string>;
    /** Render function for page content */
    renderPage: (id: string) => ReactNode;
    /**
     * Optional stable key for a page's placeholder and portal.
     * When provided, the placeholder/portal survives page ID changes
     * (e.g., during navigatePageTo where old page is replaced with new one).
     * Returns a stable key for the page, or undefined to use the page ID.
     */
    getStableKey?: (pageId: string) => string | undefined;
    /** Optional CSS class for the container */
    className?: string;
}

/**
 * Portal-based page manager with grouping support.
 *
 * Each page gets a stable placeholder div that is never destroyed until the
 * page closes. Placeholders are NEVER reparented (moved between containers)
 * because that causes iframes/webviews to reload. Instead, grouping is
 * achieved purely via CSS absolute positioning on the same container.
 *
 * React content renders into each placeholder via createPortal().
 */
export function AppPageManager({
    pageIds,
    activeId,
    groupedActiveId,
    grouping,
    compareModeIds,
    renderPage,
    getStableKey,
    className,
}: AppPageManagerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const placeholdersRef = useRef(new Map<string, HTMLDivElement>());
    const groupContainersRef = useRef(new Map<string, GroupContainer>());
    const hasBeenActiveRef = useRef(new Set<string>());

    // Resolve stable key for a page ID (falls back to page ID itself)
    const stableKey = (id: string) => getStableKey?.(id) ?? id;

    // Track which pages have been activated (for deferred rendering)
    if (activeId) hasBeenActiveRef.current.add(stableKey(activeId));
    if (groupedActiveId) hasBeenActiveRef.current.add(stableKey(groupedActiveId));

    // Create placeholders eagerly during render so createPortal finds them
    const placeholders = placeholdersRef.current;
    for (const id of pageIds) {
        const key = stableKey(id);
        if (!placeholders.has(key)) {
            const el = document.createElement("div");
            applyStandaloneStyle(el);
            el.style.display = "none";
            placeholders.set(key, el);
        }
    }

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const groupContainers = groupContainersRef.current;

        const currentKeys = new Set(pageIds.map(stableKey));
        const currentGroupKeys = new Set<string>();

        // 1. Remove placeholders for closed pages
        for (const [key, el] of placeholders) {
            if (!currentKeys.has(key)) {
                if (el.parentNode) el.parentNode.removeChild(el);
                placeholders.delete(key);
                hasBeenActiveRef.current.delete(key);
            }
        }

        // 2. Determine which groupings exist now
        for (const [leftId, rightId] of grouping) {
            if (currentKeys.has(stableKey(leftId)) && currentKeys.has(stableKey(rightId))) {
                currentGroupKeys.add(stableKey(leftId));
            }
        }

        // 3. Dispose group containers that no longer exist or whose right page changed
        for (const [leftKey, gc] of groupContainers) {
            const rightId = [...grouping.entries()].find(([l]) => stableKey(l) === leftKey)?.[1];
            const expectedRightEl = rightId && currentGroupKeys.has(leftKey)
                ? placeholders.get(stableKey(rightId))
                : undefined;
            if (!expectedRightEl || gc.rightPlaceholder !== expectedRightEl) {
                gc.dispose();
                groupContainers.delete(leftKey);
            }
        }

        // 4. Create new group containers (CSS-based, no reparenting)
        for (const leftKey of currentGroupKeys) {
            if (!groupContainers.has(leftKey)) {
                const rightId = [...grouping.entries()].find(([l]) => stableKey(l) === leftKey)?.[1];
                if (!rightId) continue;
                const leftEl = placeholders.get(leftKey)!;
                const rightEl = placeholders.get(stableKey(rightId))!;
                const gc = new GroupContainer(container, leftEl, rightEl);
                groupContainers.set(leftKey, gc);
            }
        }

        // 5. Append placeholders that aren't in the DOM yet
        for (const id of pageIds) {
            const el = placeholders.get(stableKey(id));
            if (el && !el.parentNode) {
                container.appendChild(el);
            }
        }

        // 6. Update visibility
        const activeKey = stableKey(activeId);
        const activeGroupKey = findGroupKeyStable(activeId, grouping, stableKey);

        for (const [key, el] of placeholders) {
            const groupKey = findGroupKeyByStableKey(key, grouping, stableKey);
            if (groupKey !== undefined) {
                const isActiveGroup = groupKey === activeGroupKey;
                const inCompareMode = compareModeIds ? [...compareModeIds].some(cid => stableKey(cid) === groupKey) : false;
                if (!isActiveGroup) {
                    el.style.display = "none";
                } else if (inCompareMode) {
                    const isLeft = [...grouping.keys()].some(l => stableKey(l) === key);
                    if (isLeft) {
                        applyStandaloneStyle(el);
                        el.style.display = "flex";
                    } else {
                        el.style.display = "none";
                    }
                } else {
                    el.style.display = "flex";
                }
            } else {
                el.style.display = key === activeKey ? "flex" : "none";
            }
        }

        // Update compare mode state and splitter visibility for each group
        for (const [leftKey, gc] of groupContainers) {
            const isActive = leftKey === activeGroupKey;
            const inCompareMode = compareModeIds ? [...compareModeIds].some(cid => stableKey(cid) === leftKey) : false;

            if (gc.compareMode !== inCompareMode) {
                gc.setCompareMode(inCompareMode);
            }

            gc.splitter.element.style.display = isActive && !inCompareMode ? "" : "none";
        }
    }, [pageIds, activeId, groupedActiveId, grouping, compareModeIds, placeholders, stableKey]);

    // Build the list of portals to render
    const hasBeenActive = hasBeenActiveRef.current;
    const portals: ReactNode[] = [];

    for (const id of pageIds) {
        const key = stableKey(id);
        if (!hasBeenActive.has(key)) continue;
        const placeholder = placeholders.get(key);
        if (!placeholder) continue;
        portals.push(createPortal(renderPage(id), placeholder, key));
    }

    return (
        <>
            <div ref={containerRef} className={className} />
            {portals}
        </>
    );
}

/** Apply styles for a standalone (non-grouped) page placeholder.
 *  Clears individual positioning properties first so `inset: 0` takes full effect. */
function applyStandaloneStyle(el: HTMLDivElement) {
    Object.assign(el.style, {
        top: "",
        bottom: "",
        left: "",
        right: "",
        width: "",
        minWidth: "",
        maxWidth: "",
        flex: "",
        flexShrink: "",
    });
    Object.assign(el.style, {
        position: "absolute",
        inset: "0",
        display: "flex",
        flexDirection: "row",
        overflow: "hidden",
    });
}

/** Find the group stable key for a page using stable key mapping */
function findGroupKeyStable(
    pageId: string,
    grouping: Map<string, string>,
    sk: (id: string) => string,
): string | undefined {
    if (grouping.has(pageId)) return sk(pageId);
    for (const [leftId, rightId] of grouping) {
        if (rightId === pageId) return sk(leftId);
    }
    return undefined;
}

/** Find the group stable key by a placeholder's stable key */
function findGroupKeyByStableKey(
    key: string,
    grouping: Map<string, string>,
    sk: (id: string) => string,
): string | undefined {
    for (const [leftId, rightId] of grouping) {
        if (sk(leftId) === key || sk(rightId) === key) return sk(leftId);
    }
    return undefined;
}
