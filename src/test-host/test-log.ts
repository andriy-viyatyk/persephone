import fs from "node:fs";
import path from "node:path";
import { formatStep } from "./step-format.js";

export type TestLogEvent = Record<string, unknown> & { event: string };

/** Synchronous JSONL writes keep every completed event visible if the host is terminated. */
export class TestLog {
    private readonly descriptor: number;

    constructor(readonly filePath: string) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        this.descriptor = fs.openSync(filePath, "w");
    }

    write(event: TestLogEvent): void {
        const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
        fs.writeSync(this.descriptor, line, undefined, "utf8");
    }

    close(): void {
        fs.closeSync(this.descriptor);
    }
}

export function stepEventArguments(operation: "call" | "callText" | "set", apiPath: string | undefined, args: unknown): string | undefined {
    if (args === undefined) return undefined;
    const formatted = formatStep(operation, apiPath, args);
    const prefix = `${operation} ${apiPath ?? "<overview>"} `;
    return formatted.slice(prefix.length);
}

export function resultPreview(value: unknown): string {
    let serialized: string;
    try { serialized = typeof value === "string" ? value : JSON.stringify(value); }
    catch { serialized = "[result unavailable for preview]"; }
    if (serialized === undefined) serialized = String(value);
    return serialized.length > 240 ? `${serialized.slice(0, 239)}…` : serialized;
}
