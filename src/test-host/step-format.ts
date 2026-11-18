const MAX_STEP_ARGUMENT_LENGTH = 240;

export function formatStep(operation: "call" | "callText" | "set", apiPath?: string, args?: unknown): string {
    const target = apiPath ?? "<overview>";
    if (args === undefined) return `${operation} ${target}`;
    let summary: string;
    try { summary = safePreview(args, new Set(), 0); }
    catch { summary = "[arguments unavailable for preview]"; }
    const shortened = summary.length > MAX_STEP_ARGUMENT_LENGTH
        ? `${summary.slice(0, MAX_STEP_ARGUMENT_LENGTH - 1)}…`
        : summary;
    return `${operation} ${target} ${shortened}`;
}

function safePreview(value: unknown, ancestors: Set<object>, depth: number): string {
    if (value === null || typeof value !== "object") {
        if (typeof value === "string") return JSON.stringify(value);
        if (typeof value === "bigint") return `${value}n`;
        if (typeof value === "symbol") return value.toString();
        if (typeof value === "function") return "[Function]";
        return String(value);
    }
    if (ancestors.has(value)) return "[Circular]";
    if (depth >= 3) return Array.isArray(value) ? "[…]" : "{…}";
    ancestors.add(value);
    let result: string;
    if (Array.isArray(value)) {
        result = `[${value.slice(0, 8).map((item) => safePreview(item, ancestors, depth + 1)).join(", ")}${value.length > 8 ? ", …" : ""}]`;
    } else {
        const entries: string[] = [];
        for (const key of Object.keys(value).slice(0, 8)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            entries.push(`${JSON.stringify(key)}: ${descriptor && "value" in descriptor ? safePreview(descriptor.value, ancestors, depth + 1) : "[Accessor]"}`);
        }
        result = `{${entries.join(", ")}${Object.keys(value).length > 8 ? ", …" : ""}}`;
    }
    ancestors.delete(value);
    return result;
}
