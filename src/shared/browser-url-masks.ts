/** Compile a whole-URL glob into a case-insensitive regular expression. */
function browserUrlMaskToRegExp(mask: string): RegExp {
    const escaped = mask.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const body = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${body}$`, "i");
}

/** True iff the complete URL matches the normalized browser URL glob. */
export function matchesBrowserUrlMask(url: string, mask: string): boolean {
    return browserUrlMaskToRegExp(mask).test(url);
}
