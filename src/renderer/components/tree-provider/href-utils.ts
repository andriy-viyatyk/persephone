/** Case-insensitive href equality. File paths can reach tree-provider views from the OS with
 * different casing, while selection remains case-insensitive. */
export function hrefKey(href: string): string {
    // Provider href identity is case-insensitive; filesystem watch paths use their own boundary key.
    return href.toLowerCase();
}

export function sameHref(a: string, b: string): boolean {
    return hrefKey(a) === hrefKey(b);
}

/** Order-sensitive href-list equality. The final href is the primary selection. */
export function sameHrefs(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((href, index) => sameHref(href, b[index]));
}

/** Case- and separator-insensitive href form for self/descendant drop guards. */
export function normalizeHref(href: string): string {
    return href.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
