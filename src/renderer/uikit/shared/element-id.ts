let next = 1;

/**
 * A process-unique id fragment for one component instance.
 *
 * The value is opaque and generated, so it is not a contract, but the relationship is - it gives
 * `aria-activedescendant` something to point at and is the only thing making these lists
 * keyboard-accessible. The requirement on this function is: unique per instance, and stable for that
 * instance's whole lifetime.
 *
 * Follows `tooltipRegistry.nextId()`'s shape. Do not reset the counter — an id reused after a
 * remount could collide with an `aria-activedescendant` still pointing at the previous instance.
 */
export function nextElementId(prefix: string): string {
    return `${prefix}-${next++}`;
}
