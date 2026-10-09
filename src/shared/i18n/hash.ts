/** Synchronous 32-bit FNV-1a over UTF-16 code units. */
export function fnv1aHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashEnglishMessage(value: string | Readonly<Record<string, string>>): string {
    if (typeof value === "string") return fnv1aHash(value);
    const categories = ["zero", "one", "two", "few", "many", "other"] as const;
    const canonical = categories
        .filter((category) => Object.hasOwn(value, category))
        .map((category) => `${category}:${value[category]}`)
        .join("|");
    return fnv1aHash(canonical);
}
