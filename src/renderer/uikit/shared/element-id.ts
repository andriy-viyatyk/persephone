let next = 1;

/**
 * A process-unique id fragment for one component instance.
 *
 * Replaces the former generated-ID source in converted components. The five `useId` call sites in
 *  exist only to give `aria-activedescendant` something to point at: the *value* is opaque and
 * generated, so it is not a contract, but the *relationship* is — it is the only thing making these
 * lists keyboard-accessible. So the requirement on this function is exactly the requirement on
 * `useId`: unique per instance, and stable for that instance's whole lifetime.
 *
 * Follows `tooltipRegistry.nextId()`'s shape. Do not reset the counter — an id reused after a
 * remount could collide with an `aria-activedescendant` still pointing at the previous instance.
 */
export function nextElementId(prefix: string): string {
    return `${prefix}-${next++}`;
}
