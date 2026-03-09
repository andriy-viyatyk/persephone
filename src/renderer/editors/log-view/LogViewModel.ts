import { debounce } from "../../../shared/utils";
import { ContentViewModel } from "../base/ContentViewModel";
import { IContentHost } from "../base/IContentHost";
import { LogEntry, DialogResult, isDialogEntry } from "./logTypes";
import { LogEntryModel } from "./LogEntryModel";

// =============================================================================
// State
// =============================================================================

export const defaultLogViewState = {
    entries: [] as LogEntry[],
    entryCount: 0,
    error: undefined as string | undefined,
    showTimestamps: false,
};

export type LogViewState = typeof defaultLogViewState;

// =============================================================================
// View Model
// =============================================================================

export class LogViewModel extends ContentViewModel<LogViewState> {
    /** Lazily created model instances, keyed by entry ID. */
    private modelCache = new Map<string, LogEntryModel>();

    /** Promise resolve callbacks for unresolved dialog entries. */
    private pendingDialogs = new Map<string, { resolve: (result: DialogResult) => void }>();

    /** Auto-incrementing ID counter. */
    private nextId = 1;

    /** Flag to skip reloading content that we just serialized ourselves. */
    private skipNextContentUpdate = false;

    /** Last known line count for incremental parsing. */
    private lastLineCount = 0;

    /** Currently rendered row range (for model eviction). */
    private renderedRange: { top: number; bottom: number } | null = null;

    /** Cached measured row heights by entry ID (persists across model evictions). */
    private heightCache = new Map<string, number>();

    constructor(host: IContentHost) {
        super(host, defaultLogViewState);
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    protected onInit(): void {
        const content = this.host.state.get().content || "";
        this.loadContent(content);
    }

    protected onContentChanged(content: string): void {
        if (this.skipNextContentUpdate) {
            this.skipNextContentUpdate = false;
            return;
        }
        this.loadContentIncremental(content);
    }

    protected onDispose(): void {
        // Flush all cached models
        for (const model of this.modelCache.values()) {
            model.dispose();
        }
        this.modelCache.clear();

        // Cancel all pending dialogs
        for (const { resolve } of this.pendingDialogs.values()) {
            resolve({ canceled: true });
        }
        this.pendingDialogs.clear();
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

        // Dispose all cached models — entries array is replaced
        for (const model of this.modelCache.values()) {
            model.dispose();
        }
        this.modelCache.clear();

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

    /** Add a log entry and append it to the host content. */
    addEntry(type: string, data: any): LogEntry {
        const entry: LogEntry = {
            type,
            id: String(this.nextId++),
            data,
            timestamp: Date.now(),
        };

        this.state.update((s) => {
            s.entries = [...s.entries, entry];
            s.entryCount = s.entries.length;
        });

        this.appendToContent(entry);
        return entry;
    }

    /** Add a dialog entry and return a Promise that resolves when the user responds. */
    addDialogEntry<T = any>(type: string, data: T): Promise<DialogResult> {
        const entry = this.addEntry(type, data);

        return new Promise<DialogResult>((resolve) => {
            this.pendingDialogs.set(entry.id, { resolve });
        });
    }

    /** Resolve a pending dialog. Updates the entry data and resolves the Promise. */
    resolveDialog(id: string, result: any, resultButton?: string): void {
        const entries = this.state.get().entries;
        const entry = entries.find((e) => e.id === id);
        if (!entry) return;

        // Update plain entry data
        entry.data = { ...entry.data, result, resultButton };

        // Update cached model if any
        const model = this.modelCache.get(id);
        if (model) {
            model.update(entry.data);
        }

        // Update the line in host content
        this.updateEntryInContent(entry);

        // Resolve the Promise
        const pending = this.pendingDialogs.get(id);
        if (pending) {
            pending.resolve({ result, resultButton });
            this.pendingDialogs.delete(id);
        }
    }

    /** Update an entry's data (e.g., progress value). */
    updateEntry(id: string, data: any): void {
        const entries = this.state.get().entries;
        const entry = entries.find((e) => e.id === id);
        if (!entry) return;

        entry.data = { ...entry.data, ...data };

        // Update cached model if any
        const model = this.modelCache.get(id);
        if (model) {
            model.update(entry.data);
        }

        this.updateEntryInContentDebounced();
    }

    /** Remove all entries. */
    clear(): void {
        // Dispose all cached models
        for (const model of this.modelCache.values()) {
            model.dispose();
        }
        this.modelCache.clear();

        // Cancel all pending dialogs
        for (const { resolve } of this.pendingDialogs.values()) {
            resolve({ canceled: true });
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
        this.host.changeContent("", true);
    }

    // =========================================================================
    // Model Cache (Lazy Instantiation)
    // =========================================================================

    /** Get or create a model for the entry at the given index. */
    getModel(index: number): LogEntryModel | null {
        const entries = this.state.get().entries;
        if (index < 0 || index >= entries.length) return null;

        const entry = entries[index];
        let model = this.modelCache.get(entry.id);
        if (!model) {
            model = new LogEntryModel(entry);
            this.modelCache.set(entry.id, model);
        }
        return model;
    }

    /** Get or create a model for the entry with the given ID. */
    getEntry(id: string): LogEntryModel | null {
        // Check cache first
        let model = this.modelCache.get(id);
        if (model) return model;

        // Find in entries array
        const entries = this.state.get().entries;
        const entry = entries.find((e) => e.id === id);
        if (!entry) return null;

        model = new LogEntryModel(entry);
        this.modelCache.set(id, model);
        return model;
    }

    /**
     * Called by the virtualized grid when the rendered range changes.
     * Evicts models outside the visible range (debounced).
     */
    setRenderedRange(top: number, bottom: number): void {
        this.renderedRange = { top, bottom };
        this.evictModelsDebounced();
    }

    private evictModels = () => {
        if (!this.renderedRange) return;
        const { top, bottom } = this.renderedRange;
        const entries = this.state.get().entries;

        for (const [id, model] of this.modelCache) {
            const index = entries.findIndex((e) => e.id === id);
            if (index === -1 || index < top || index > bottom) {
                model.dispose();
                this.modelCache.delete(id);
            }
        }
    };

    private evictModelsDebounced = debounce(this.evictModels, 500);

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
        this.host.changeContent(newContent, true);
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
            this.host.changeContent(lines.join("\n"), true);
        }
    }

    /** Debounced version for frequent updates (e.g., progress). */
    private updateEntryInContentDebounced = debounce(() => {
        // Re-serialize all entries that have cached models with changes
        const content = this.host.state.get().content;
        const lines = content.split("\n");
        let changed = false;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) continue;
            try {
                const parsed = JSON.parse(trimmed);
                const model = this.modelCache.get(parsed.id);
                if (model) {
                    const updated = JSON.stringify(model.toJSON());
                    if (lines[i] !== updated) {
                        lines[i] = updated;
                        changed = true;
                    }
                }
            } catch {
                // skip malformed lines
            }
        }

        if (changed) {
            this.skipNextContentUpdate = true;
            this.host.changeContent(lines.join("\n"), true);
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
}

export function createLogViewModel(host: IContentHost): LogViewModel {
    return new LogViewModel(host);
}
