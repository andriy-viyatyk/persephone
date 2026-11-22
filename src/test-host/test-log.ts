import fs from "node:fs";
import path from "node:path";
import { formatStep } from "./step-format.js";
import { sensitiveMemberKind, sensitiveSummary, StorageStateRedactor } from "./storage-state-redaction.js";

export type TestLogEvent = Record<string, unknown> & { event: string };

/** Synchronous JSONL writes keep every completed event visible if the host is terminated. */
export class TestLog {
    private readonly descriptor: number;
    readonly redactor = new StorageStateRedactor();

    constructor(readonly filePath: string, private readonly onEvent?: (event: TestLogEvent) => void) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        this.descriptor = fs.openSync(filePath, "w");
    }

    write(event: TestLogEvent): void {
        const redacted = this.redactor.redact({ at: new Date().toISOString(), ...event }) as TestLogEvent;
        const line = `${JSON.stringify(redacted)}\n`;
        fs.writeSync(this.descriptor, line, undefined, "utf8");
        this.onEvent?.(redacted);
    }

    close(): void {
        fs.closeSync(this.descriptor);
    }
}

export function stepEventArguments(operation: "call" | "callText" | "set", apiPath: string | undefined, args: unknown, redactor?: StorageStateRedactor): string | undefined {
    if (args === undefined) return undefined;
    const sensitiveKind = sensitiveMemberKind(apiPath);
    if (sensitiveKind) return sensitiveSummary(args, sensitiveKind);
    const formatted = formatStep(operation, apiPath, args, redactor);
    const prefix = `${operation} ${apiPath ?? "<overview>"} `;
    return formatted.slice(prefix.length);
}

export function resultPreview(value: unknown, apiPath?: string, redactor?: StorageStateRedactor): string {
    const sensitiveKind = sensitiveMemberKind(apiPath);
    if (sensitiveKind === "storage-state" || sensitiveKind === "apply-storage-state" || sensitiveKind === "init-script"
        || sensitiveKind === "clipboard-read" || sensitiveKind === "clipboard-write" || sensitiveKind === "clipboard-reset") return sensitiveSummary(value, sensitiveKind);
    let serialized: string;
    try { serialized = typeof value === "string" ? redactor?.scrub(value) ?? value : JSON.stringify(redactor?.redact(value) ?? value); }
    catch { serialized = "[result unavailable for preview]"; }
    if (serialized === undefined) serialized = String(value);
    return serialized.length > 240 ? `${serialized.slice(0, 239)}…` : serialized;
}
