import { errMessage } from "../../../shared/utils";
import { tryParseJson } from "../../core/utils/parse-utils";
import type { LogEntry } from "./logTypes";

export interface LogDocumentParseResult {
    readonly error: string | undefined;
}

export type LogDocumentIncrementalResult =
    | { readonly kind: "full"; readonly error: string | undefined }
    | {
        readonly kind: "incremental";
        readonly firstNewEntry: number;
        readonly newEntries: readonly LogEntry[];
        readonly error: string | undefined;
    };

/** Owns parsed Log View entries and their JSONL line and ID bookkeeping. */
export class JsonlLogDocument {
    private entries: LogEntry[] = [];
    private lastLineCount = 0;
    private nextId = 1;

    get entryCount(): number {
        return this.entries.length;
    }

    getEntries(): readonly LogEntry[] {
        return this.entries;
    }

    getEntryAt(index: number): LogEntry | undefined {
        return this.entries[index];
    }

    getEntryById(id: string): LogEntry | undefined {
        return this.entries.find((entry) => entry.id === id);
    }

    getEntryIndexById(id: string): number {
        return this.entries.findIndex((entry) => entry.id === id);
    }

    appendEntry(entry: LogEntry): void {
        this.entries.push(entry);
    }

    appendEntries(entries: readonly LogEntry[]): void {
        this.entries.push(...entries);
    }

    replaceEntry(index: number, entry: LogEntry): void {
        this.entries[index] = entry;
    }

    reset(): void {
        this.entries = [];
        this.lastLineCount = 0;
        this.nextId = 1;
    }

    parse(content: string): LogDocumentParseResult {
        const entries: LogEntry[] = [];
        let error: string | undefined;

        if (content.trim()) {
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                try {
                    const parsed = JSON.parse(line);
                    if (typeof parsed === "object" && parsed !== null && parsed.type && parsed.id) {
                        entries.push(parsed as LogEntry);
                    } else {
                        error = `Line ${i + 1}: not a valid log entry (missing type or id)`;
                        break;
                    }
                } catch (e) {
                    error = `Line ${i + 1}: ${errMessage(e)}`;
                    break;
                }
            }
        }

        this.entries = entries;
        this.nextId = 1;
        for (const entry of entries) this.observeEntryId(entry.id);
        this.lastLineCount = content.trim() ? content.split("\n").length : 0;
        return { error };
    }

    appendIncremental(content: string): LogDocumentIncrementalResult {
        if (!content.trim()) {
            return { kind: "full", error: this.parse(content).error };
        }

        const lines = content.split("\n");
        const newLineCount = lines.length;
        const currentEntries = this.entries;

        if (newLineCount < this.lastLineCount || currentEntries.length === 0) {
            return { kind: "full", error: this.parse(content).error };
        }

        const firstLine = lines[0].trim();
        if (firstLine && currentEntries.length > 0) {
            const firstParsed = tryParseJson<{ id?: string } | null>(firstLine, null);
            if (!firstParsed || firstParsed.id !== currentEntries[0].id) {
                return { kind: "full", error: this.parse(content).error };
            }
        }

        const newEntries: LogEntry[] = [];
        let error: string | undefined;

        for (let i = this.lastLineCount; i < newLineCount; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            try {
                const parsed = JSON.parse(line);
                if (typeof parsed === "object" && parsed !== null && parsed.type && parsed.id) {
                    newEntries.push(parsed as LogEntry);
                } else {
                    error = `Line ${i + 1}: not a valid log entry (missing type or id)`;
                    break;
                }
            } catch (e) {
                error = `Line ${i + 1}: ${errMessage(e)}`;
                break;
            }
        }

        const firstNewEntry = this.entries.length;
        if (newEntries.length > 0) {
            for (const entry of newEntries) this.observeEntryId(entry.id);
            this.appendEntries(newEntries);
        }
        this.lastLineCount = newLineCount;
        return { kind: "incremental", firstNewEntry, newEntries, error };
    }

    nextEntryId(): string {
        return String(this.nextId++);
    }

    observeEntryId(id: string): void {
        const numId = parseInt(id, 10);
        if (!isNaN(numId) && numId >= this.nextId) {
            this.nextId = numId + 1;
        }
    }

    serializeAppend(content: string, entry: LogEntry): string {
        const line = JSON.stringify(entry);
        const newContent = content ? content + "\n" + line : line;
        this.lastLineCount = newContent.split("\n").length;
        return newContent;
    }

    serializeEntry(id: string, entry: LogEntry, lines: string[]): boolean {
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) continue;
            const parsed = tryParseJson<{ id?: string } | null>(trimmed, null);
            if (parsed?.id === id) {
                lines[i] = JSON.stringify(entry);
                return true;
            }
        }
        return false;
    }

    serializeDirtyEntries(indices: ReadonlySet<number>, lines: string[]): boolean {
        let changed = false;
        for (const idx of indices) {
            const entry = this.entries[idx];
            if (!entry) continue;
            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (!trimmed) continue;
                const parsed = tryParseJson<{ id?: string } | null>(trimmed, null);
                if (parsed?.id === entry.id) {
                    const updated = JSON.stringify(entry);
                    if (lines[i] !== updated) {
                        lines[i] = updated;
                        changed = true;
                    }
                    break;
                }
            }
        }
        return changed;
    }
}
