export function normalizeStringList(
    raw: unknown,
    options: {
        map: (entry: string) => string;
        max?: number;
        accept?: (value: string, acceptedSoFar: readonly string[]) => boolean;
    },
): string[] {
    if (!Array.isArray(raw)) return [];
    const values: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        const value = options.map(entry);
        if (!value || values.includes(value)) continue;
        if (options.accept && !options.accept(value, values)) continue;
        values.push(value);
        if (options.max !== undefined && values.length >= options.max) break;
    }
    return values;
}
