type ListNavigationKey = "ArrowDown" | "ArrowUp" | "PageDown" | "PageUp" | "Home" | "End";

interface ListNavigationOptions {
    wrap: boolean;
    page: number;
    pageStart: "zero" | "before-first";
    pageFallback: "none" | "opposite-end";
    isEnabled?: (index: number) => boolean;
}

/**
 * Walk forward (`dir=1`) or backward (`dir=-1`) from `start` until an enabled item is found.
 * Returns undefined when no candidate exists in that direction.
 */
function scan(start: number, dir: 1 | -1, count: number, isEnabled: (index: number) => boolean): number | undefined {
    for (let index = start; index >= 0 && index < count; index += dir) {
        if (isEnabled(index)) return index;
    }
    return undefined;
}

function clamp(index: number, last: number): number {
    return Math.max(0, Math.min(last, index));
}

export function nextActiveIndex(
    key: ListNavigationKey,
    current: number | null | undefined,
    count: number,
    options: ListNavigationOptions,
): number | undefined {
    if (count <= 0) return undefined;

    const last = count - 1;
    const active = current == null || current < 0 ? undefined : current;
    const isEnabled = options.isEnabled ?? (() => true);

    if (key === "Home") return scan(0, 1, count, isEnabled);
    if (key === "End") return scan(last, -1, count, isEnabled);

    if (key === "ArrowDown" || key === "ArrowUp") {
        const dir = key === "ArrowDown" ? 1 : -1;
        if (options.wrap) {
            const start = active === undefined
                ? (dir === 1 ? 0 : last)
                : active + dir;
            for (let step = 0; step < count; step++) {
                const index = ((start + step * dir) % count + count) % count;
                if (isEnabled(index)) return index;
            }
            return undefined;
        }

        const candidate = key === "ArrowDown"
            ? clamp((active ?? -1) + 1, last)
            : clamp((active ?? 0) - 1, last);
        return scan(candidate, dir, count, isEnabled);
    }

    const dir = key === "PageDown" ? 1 : -1;
    const start = active === undefined
        ? key === "PageDown" && options.pageStart === "before-first" ? -1 : 0
        : active;
    const landing = clamp(start + dir * options.page, last);
    const target = scan(landing, dir, count, isEnabled);
    if (target !== undefined || options.pageFallback === "none") return target;
    return dir === 1
        ? scan(last, -1, count, isEnabled)
        : scan(0, 1, count, isEnabled);
}
