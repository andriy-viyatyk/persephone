import { debounce } from "../../../shared/utils";
import { parseObject } from "../../core/utils/parse-utils";
import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { LogEntry } from "./logTypes";

// =============================================================================
// State
// =============================================================================

export const defaultLogViewState = {
    entries: [] as LogEntry[],
    entryCount: 0,
    error: undefined as string | undefined,
    showTimestamps: false,
    /** Incremented when a dialog entry is added. Forces scroll-to-bottom regardless of scroll position. */
    forceScrollVersion: 0,
    /** Per-item auxiliary state (columns, focus, etc.) keyed by entry ID. Not serialized to JSONL. */
    itemsState: {} as Record<string, Record<string, any>>,
};

export type LogViewState = typeof defaultLogViewState;

// =============================================================================
// View Model
// =============================================================================

export class LogViewModel extends ContentViewModel<LogViewState> {
    /** Promise resolve callbacks for unresolved dialog entries. */
    private pendingDialogs = new Map<string, { resolve: (result: LogEntry) => void }>();

    /** Auto-incrementing ID counter. */
    private nextId = 1;

    /** Flag to skip reloading content that we just serialized ourselves. */
    private skipNextContentUpdate = false;

    /** Last known line count for incremental parsing. */
    private lastLineCount = 0;

    /** Cached measured row heights by entry ID (persists across model evictions). */
    private heightCache = new Map<string, number>();

    /** Entry indices with pending changes that need JSONL serialization. */
    private dirtyIndices = new Set<number>();

    /** State storage key for persisting itemsState. */
    private readonly stateName = "log-view-items";

    constructor(host: IContentHost) {
        super(host, defaultLogViewState);
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    protected onInit(): void {
        const content = this.host.state.get().content || "";
        this.loadContent(content);
        this.restoreItemsState();
    }

    protected onContentChanged(content: string): void {
        if (this.skipNextContentUpdate) {
            this.skipNextContentUpdate = false;
            return;
        }
        this.loadContentIncremental(content);
    }

    protected onDispose(): void {
        // Cancel all pending dialogs (button: undefined = canceled)
        for (const [id, { resolve }] of this.pendingDialogs.entries()) {
            resolve({ type: "", id, timestamp: 0 });
        }
        this.pendingDialogs.clear();
        this.dirtyIndices.clear();
        this.saveItemsState();
    }

    // =========================================================================
    // Content Parsing
    // =========================================================================

    /** Full parse of JSONL content. Used on initial load and when incremental fails. */
    private loadContent(content: string): void {
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
                    error = `Line ${i + 1}: ${(e as Error).message}`;
                    break;
                }
            }
        }

        // Restore ID counter from max existing ID
        this.nextId = 1;
        for (const entry of entries) {
            const numId = parseInt(entry.id, 10);
            if (!isNaN(numId) && numId >= this.nextId) {
                this.nextId = numId + 1;
            }
        }

        this.lastLineCount = content.trim() ? content.split("\n").length : 0;

        this.state.update((s) => {
            s.entries = entries;
            s.entryCount = entries.length;
            s.error = error;
        });
    }

    /**
     * Incremental parse: if only new lines were appended, parse only those.
     * Falls back to full parse if existing lines changed.
     */
    private loadContentIncremental(content: string): void {
        if (!content.trim()) {
            this.loadContent(content);
            return;
        }

        const lines = content.split("\n");
        const newLineCount = lines.length;
        const currentEntries = this.state.get().entries;

        // If lines decreased or we have no prior state, full re-parse
        if (newLineCount < this.lastLineCount || currentEntries.length === 0) {
            this.loadContent(content);
            return;
        }

        // Check if first line matches (simple heuristic for detecting edits in existing lines)
        const firstLine = lines[0].trim();
        if (firstLine && currentEntries.length > 0) {
            try {
                const firstParsed = JSON.parse(firstLine);
                if (firstParsed.id !== currentEntries[0].id) {
                    this.loadContent(content);
                    return;
                }
            } catch {
                this.loadContent(content);
                return;
            }
        }

        // Parse only new trailing lines
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
                error = `Line ${i + 1}: ${(e as Error).message}`;
                break;
            }
        }

        if (newEntries.length > 0) {
            // Update ID counter
            for (const entry of newEntries) {
                const numId = parseInt(entry.id, 10);
                if (!isNaN(numId) && numId >= this.nextId) {
                    this.nextId = numId + 1;
                }
            }

            this.state.update((s) => {
                s.entries = [...s.entries, ...newEntries];
                s.entryCount = s.entries.length;
                if (error) s.error = error;
            });
        } else if (error) {
            this.state.update((s) => {
                s.error = error;
            });
        }

        this.lastLineCount = newLineCount;
    }

    // =========================================================================
    // Entry Management
    // =========================================================================

    /** Add a log entry and append it to the host content.
     *  If `fields.id` matches an existing entry, updates it in-place (upsert). */
    addEntry(type: string, fields: any): LogEntry {
        const id = fields?.id != null ? String(fields.id) : String(this.nextId++);
        // Ensure nextId stays ahead of any user-provided id
        const numId = parseInt(id, 10);
        if (!isNaN(numId) && numId >= this.nextId) {
            this.nextId = numId + 1;
        }

        // Upsert: if entry with this ID already exists, update it in-place
        if (fields?.id != null) {
            const existingIndex = this.state.get().entries.findIndex((e) => e.id === id);
            if (existingIndex >= 0) {
                this.state.update((s) => {
                    const existing = s.entries[existingIndex];
                    s.entries[existingIndex] = { ...existing, ...fields, type, id };
                });
                const updatedEntry = this.state.get().entries[existingIndex];
                this.updateEntryInContent(updatedEntry);
                // Clear cached height so the virtual grid remeasures the row
                this.heightCache.delete(id);
                return updatedEntry;
            }
        }

        // For log entries, fields is StyledText → wrap as { text }
        // For dialog/output entries, fields is already an object → spread
        const entry: LogEntry = typeof fields === "string" || Array.isArray(fields)
            ? { type, id, text: fields, timestamp: Date.now() }
            : { type, id, ...fields, timestamp: Date.now() };

        this.state.update((s) => {
            s.entries = [...s.entries, entry];
            s.entryCount = s.entries.length;
        });

        this.appendToContent(entry);
        return entry;
    }

    /** Add a dialog entry and return a Promise that resolves when the user responds. */
    addDialogEntry(type: string, fields: Record<string, any>): Promise<LogEntry> {
        const entry = this.addEntry(type, fields);

        // Force scroll-to-bottom so the user sees the dialog (script is blocked waiting for input)
        this.state.update((s) => { s.forceScrollVersion++; });

        return new Promise<LogEntry>((resolve) => {
            this.pendingDialogs.set(entry.id, { resolve });
        });
    }

    /** Resolve a pending dialog. Sets `button` on the flat entry and resolves the Promise with full entry. */
    resolveDialog(id: string, button: string): void {
        this.state.update((s) => {
            const entry = s.entries.find((e) => e.id === id);
            if (entry) {
                entry.button = button;
            }
        });

        // Serialize immediately (not debounced — one-time event)
        const updatedEntry = this.state.get().entries.find((e) => e.id === id);
        if (updatedEntry) {
            this.updateEntryInContent(updatedEntry);
        }

        // Resolve the Promise with the full flat entry
        const pending = this.pendingDialogs.get(id);
        if (pending) {
            pending.resolve(updatedEntry!);
            this.pendingDialogs.delete(id);
        }
    }

    /** Update an entry's text by ID. Used by StyledLogBuilder.print().
     *  Serializes immediately (not debounced) to prevent race conditions where
     *  page setup triggers onContentChanged before the debounced flush, overwriting
     *  the in-memory styled data with stale JSONL content. */
    updateEntryText(id: string, text: any): void {
        const entries = this.state.get().entries;
        const index = entries.findIndex((e) => e.id === id);
        if (index < 0) return;

        this.state.update((s) => {
            s.entries[index] = { ...s.entries[index], text };
        });

        const updatedEntry = this.state.get().entries[index];
        if (updatedEntry) {
            this.updateEntryInContent(updatedEntry);
        }
    }

    /** Update entry at index via immer updater. Marks dirty for debounced JSONL serialization. */
    updateEntryAt(index: number, updater: (draft: LogEntry) => void): void {
        this.state.update((s) => {
            updater(s.entries[index]);
        });
        this.dirtyIndices.add(index);
        this.flushDirtyDebounced();
    }

    /** Update an entry by ID. Finds the entry and delegates to updateEntryAt. */
    updateEntryById(id: string, updater: (draft: LogEntry) => void): void {
        const index = this.state.get().entries.findIndex((e) => e.id === id);
        if (index >= 0) {
            this.updateEntryAt(index, updater);
        }
    }

    /** Remove all entries. */
    clear = (): void => {
        // Cancel all pending dialogs (button: undefined = canceled)
        for (const [id, { resolve }] of this.pendingDialogs.entries()) {
            resolve({ type: "", id, timestamp: 0 });
        }
        this.pendingDialogs.clear();

        this.nextId = 1;
        this.lastLineCount = 0;

        this.state.update((s) => {
            s.entries = [];
            s.entryCount = 0;
            s.error = undefined;
        });

        this.skipNextContentUpdate = true;
        this.host.changeContent("");
    };

    // =========================================================================
    // Content Serialization
    // =========================================================================

    /** Append a single entry as a JSONL line to host content. */
    private appendToContent(entry: LogEntry): void {
        const line = JSON.stringify(entry);
        const currentContent = this.host.state.get().content;
        const newContent = currentContent ? currentContent + "\n" + line : line;

        this.lastLineCount = newContent.split("\n").length;
        this.skipNextContentUpdate = true;
        this.host.changeContent(newContent);
    }

    /** Re-serialize a single entry's line in the host content. */
    private updateEntryInContent(entry: LogEntry): void {
        const content = this.host.state.get().content;
        const lines = content.split("\n");
        let updated = false;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) continue;
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed.id === entry.id) {
                    lines[i] = JSON.stringify(entry);
                    updated = true;
                    break;
                }
            } catch {
                // skip malformed lines
            }
        }

        if (updated) {
            this.skipNextContentUpdate = true;
            this.host.changeContent(lines.join("\n"));
        }
    }

    /** Debounced flush of dirty entries to JSONL content. */
    private flushDirtyDebounced = debounce(() => {
        if (this.dirtyIndices.size === 0) return;
        const entries = this.state.get().entries;
        const content = this.host.state.get().content;
        const lines = content.split("\n");
        let changed = false;

        for (const idx of this.dirtyIndices) {
            const entry = entries[idx];
            if (!entry) continue;
            for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (!trimmed) continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed.id === entry.id) {
                        const updated = JSON.stringify(entry);
                        if (lines[i] !== updated) {
                            lines[i] = updated;
                            changed = true;
                        }
                        break;
                    }
                } catch { /* skip */ }
            }
        }
        this.dirtyIndices.clear();

        if (changed) {
            this.skipNextContentUpdate = true;
            this.host.changeContent(lines.join("\n"));
        }
    }, 300);

    // =========================================================================
    // Queries
    // =========================================================================

    /** Toggle timestamp display. */
    toggleTimestamps = (): void => {
        this.state.update((s) => {
            s.showTimestamps = !s.showTimestamps;
        });
    };

    /** Check if a dialog entry is still pending (awaiting user response). */
    isDialogPending(id: string): boolean {
        return this.pendingDialogs.has(id);
    }

    /** Get the total number of entries. */
    get entryCount(): number {
        return this.state.get().entryCount;
    }

    // =========================================================================
    // Height Cache (for RenderFlexGrid)
    // =========================================================================

    /** Get the cached height for an entry (used by getInitialRowHeight). */
    getEntryHeight(id: string): number | undefined {
        return this.heightCache.get(id);
    }

    /** Store a measured row height (called from the cell's ResizeObserver). */
    setEntryHeight(id: string, height: number): void {
        this.heightCache.set(id, height);
    }

    // =========================================================================
    // Per-Item Auxiliary State
    // =========================================================================

    /** Get an item's auxiliary state (columns, focus, etc.). */
    getItemState(id: string): Record<string, any> {
        return this.state.get().itemsState[id] ?? {};
    }

    /** Patch an item's auxiliary state (shallow merge). */
    setItemState(id: string, patch: Record<string, any>): void {
        this.state.update((s) => {
            s.itemsState[id] = { ...s.itemsState[id], ...patch };
        });
        this.saveItemsStateDebounced();
    }

    // =========================================================================
    // Items State Persistence
    // =========================================================================

    private saveItemsState = async () => {
        const storage = this.host.stateStorage;
        const itemsState = this.state.get().itemsState;
        if (Object.keys(itemsState).length === 0) return;
        await storage.setState(this.host.id, this.stateName, JSON.stringify(itemsState));
    };

    private saveItemsStateDebounced = debounce(this.saveItemsState, 500);

    private restoreItemsState = async () => {
        const storage = this.host.stateStorage;
        const data = await storage.getState(this.host.id, this.stateName);
        const saved = parseObject(data);
        if (saved && typeof saved === "object") {
            this.state.update((s) => {
                s.itemsState = saved as Record<string, Record<string, any>>;
            });
        }
    };
}

export function createLogViewModel(host: IContentHost): LogViewModel {
    return new LogViewModel(host);
}
