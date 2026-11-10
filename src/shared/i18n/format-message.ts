import type { PackMessage } from "./pack";

export function formatMessage(message: PackMessage | undefined, fallback: PackMessage | undefined, params: Record<string, unknown> | undefined, selectCategory: (count: number) => Intl.LDMLPluralRule): string | undefined {
    let selected = message ?? fallback;
    if (selected && typeof selected === "object") {
        const count = params?.count;
        const category = typeof count === "number" ? selectCategory(count) : "other";
        const fallbackMessage = fallback && typeof fallback === "object"
            ? fallback[category] ?? fallback.other
            : fallback;
        selected = selected[category] ?? selected.other ?? fallbackMessage;
    }
    if (typeof selected !== "string") return undefined;
    return selected.replace(/\{([\w.-]+)\}/g, (match, name: string) => {
        const value = params?.[name];
        return value === undefined || value === null ? match : String(value);
    });
}

