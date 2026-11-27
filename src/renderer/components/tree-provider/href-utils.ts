import { hrefCompareKey } from "../../../shared/path-containment";
import { pathsAreCaseInsensitive } from "../../../shared/platform";
import { boardSchemeOwner, schemeOf } from "../../content/scheme-registry";

/** Href equality follows the platform's case rule; separators are compared as written. */
export function hrefKey(href: string): string {
    const scheme = schemeOf(href);
    return pathsAreCaseInsensitive && !(scheme && boardSchemeOwner(scheme))
        ? href.toLowerCase()
        : href;
}

export function sameHref(a: string, b: string): boolean {
    return hrefKey(a) === hrefKey(b);
}

/** Order-sensitive href-list equality. The final href is the primary selection. */
export function sameHrefs(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((href, index) => sameHref(href, b[index]));
}

/** Platform-aware href form for self/descendant drop guards. */
export function normalizeHref(href: string): string {
    const scheme = schemeOf(href);
    const normalized = pathsAreCaseInsensitive && !(scheme && boardSchemeOwner(scheme))
        ? hrefCompareKey(href)
        : href;
    return normalized.replace(/\/+$/, "");
}
