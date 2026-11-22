/** JSON-safe values accepted as arguments to page-authored functions. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = Array.isArray(value)
        ? value.every(item => isJsonValue(item, seen))
        : Object.getPrototypeOf(value) === Object.prototype
            && Object.values(value as Record<string, unknown>).every(item => isJsonValue(item, seen));
    seen.delete(value);
    return valid;
}
