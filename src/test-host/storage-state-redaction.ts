export const TUNING_CONSTANTS = {
    MIN_SECRET_LENGTH_FOR_REDACTION: 8,
    MAX_SUMMARY_ITEMS: 100_000,
} as const;

export type SensitiveMemberKind = "storage-state" | "storage-set" | "init-script" | "apply-storage-state" | "clipboard-read" | "clipboard-write" | "clipboard-reset";

export function sensitiveMemberKind(apiPath: string | undefined): SensitiveMemberKind | undefined {
    if (!apiPath) return undefined;
    // Match the trailing member after `editor` whatever prefix addresses the page:
    // `pages["id"].editor.x`, `windows[1].pages[2].editor.x`, `page.editor.x`.
    const member = apiPath.trim();
    if (/(?:^|[.\]])editor\.storageState$/.test(member)) return "storage-state";
    if (/(?:^|[.\]])editor\.storage\.set$/.test(member)) return "storage-set";
    if (/(?:^|[.\]])editor\.addInitScript$/.test(member)) return "init-script";
    if (/(?:^|[.\]])editor\.applyStorageStateForTestRun$/.test(member)) return "apply-storage-state";
    if (/(?:^|[.\]])editor\.clipboard\.readText$/.test(member)) return "clipboard-read";
    if (/(?:^|[.\]])editor\.clipboard\.writeText$/.test(member)) return "clipboard-write";
    if (/(?:^|[.\]])editor\.clearClipboardForTestRun$/.test(member)) return "clipboard-reset";
    return undefined;
}

export class StorageStateRedactor {
    private readonly secrets = new Set<string>();

    registerState(value: unknown): void {
        const collect = (item: unknown, key?: string, arrayValue = false, depth = 0): void => {
            if (depth > 20) return;
            if (typeof item === "string") {
                if ((key === "value" || arrayValue || depth === 0) && shouldRegister(item)) this.secrets.add(item);
                return;
            }
            if (Array.isArray(item)) {
                for (const child of item.slice(0, TUNING_CONSTANTS.MAX_SUMMARY_ITEMS)) collect(child, undefined, true, depth + 1);
            } else if (item && typeof item === "object") {
                for (const [childKey, child] of Object.entries(item).slice(0, TUNING_CONSTANTS.MAX_SUMMARY_ITEMS)) collect(child, childKey, false, depth + 1);
            }
        };
        collect(value);
    }

    registerClipboard(value: unknown): void {
        visit(value, (item) => {
            if (typeof item === "string" && item.length > 0) this.secrets.add(item);
        });
    }

    scrub(value: string): string {
        let result = value;
        for (const secret of this.secrets) result = result.replaceAll(secret, "[redacted]");
        return result;
    }

    summary(value: unknown): string {
        const counts = summarize(value);
        return `[sensitive data omitted: ${counts.items} items, ${counts.characters} characters]`;
    }

    redact(value: unknown): unknown {
        if (typeof value === "string") return this.scrub(value);
        if (Array.isArray(value)) return value.map((item) => this.redact(item));
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.redact(item)]));
        }
        return value;
    }
}

export function sensitiveSummary(value: unknown, kind: SensitiveMemberKind): string {
    if (kind === "storage-set") return "[sensitive storage value omitted]";
    if (kind === "clipboard-write") return "[sensitive clipboard value omitted]";
    const { items, characters } = summarize(value);
    return `[sensitive data omitted: ${items} items, ${characters} characters]`;
}

function shouldRegister(value: string): boolean {
    return value.length >= TUNING_CONSTANTS.MIN_SECRET_LENGTH_FOR_REDACTION
        && !["true", "false", "null", "undefined"].includes(value.toLowerCase())
        && !/^[-+]?\d+(?:\.\d+)?$/.test(value);
}

function visit(value: unknown, consume: (item: unknown) => void, depth = 0): void {
    if (depth > 20) return;
    consume(value);
    if (Array.isArray(value)) for (const item of value.slice(0, TUNING_CONSTANTS.MAX_SUMMARY_ITEMS)) visit(item, consume, depth + 1);
    else if (value && typeof value === "object") for (const item of Object.values(value).slice(0, TUNING_CONSTANTS.MAX_SUMMARY_ITEMS)) visit(item, consume, depth + 1);
}

function summarize(value: unknown): { items: number; characters: number } {
    let items = 0;
    let characters = 0;
    visit(value, (item) => {
        if (typeof item === "string") { items++; characters += item.length; }
        else if (item !== null && typeof item !== "object") items++;
    });
    return { items, characters };
}
