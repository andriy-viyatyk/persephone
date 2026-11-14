import { EditorId } from "../../../shared/editor-ids";
import { TComponentState } from "../../core/state/state";
import type { EditorStateBase } from "../base/EditorModel";
import { TextHostEditorModel } from "../base/TextHostEditorModel";
import { TextFileModel } from "../content-host/TextFileModel";
import { debounce } from "../../../shared/utils";
import type { LogEntry, StyledText } from "./logTypes";
import { isDialogEntry, isDialogResolved } from "./log-entry-types";
import { JsonlLogDocument } from "./JsonlLogDocument";
import type { LogViewDialogAnswerReporter } from "./log-view-dialog-answer-reporter";

export type LogQueueEvent =
    | { type: "focus" }
    | { type: "scrollToBottom" };

export type LogQueueRequest = never;

export type LogRenderChange =
    | number[]
    | { from: number; to: number }
    | "all";

/**
 * HS1 host-slot shape — only the bounded `showTimestamps` flag rides here.
 * `itemsState` is intentionally NOT in this shape (see task doc Background HS1
 * amendment — per-entry aux state would write-storm openFiles0.json).
 */
interface LogViewSettings {
    showTimestamps?: boolean;
}

function copyLogValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(copyLogValue);
    if (value && typeof value === "object") {
        const copy: Record<string, unknown> = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            copy[key] = copyLogValue(nestedValue);
        }
        return copy;
    }
    return value;
}

export interface LogViewEditorState extends EditorStateBase {
    // HS1 — rides host.editorSettings["log-view"]. Bounded boolean, safe to persist.
    showTimestamps: boolean;
    // Per-item — present on state for in-session reactivity but NOT persisted
    // (neither on descriptor nor host slot). Resets on restart and on
    // Monaco↔LogView switch. Size scales with entry count; persistence would
    // write-storm openFiles0.json.
    itemsState: Record<string, Record<string, unknown>>;
    // View-derived — present on state for reactive read; stripped from
    // getRestoreData per MO5 / GR8 pattern. Recomputed from host content on restore.
    entriesVersion: number;
    /** Exact rendered entry rows changed by the current entriesVersion update. */
    renderChange: LogRenderChange;
    entryCount: number;
    error: string | undefined;
}

export const defaultLogViewEditorState: LogViewEditorState = {
    id: "",
    title: "",
    modified: false,
    secondaryView: undefined,
    showTimestamps: false,
    itemsState: {},
    entriesVersion: 0,
    renderChange: "all",
    entryCount: 0,
    error: undefined,
};

export class LogViewEditor extends TextHostEditorModel<LogViewEditorState, LogQueueEvent, LogQueueRequest> {
    readonly editorId = EditorId.logView;
    protected readonly displayName = "Log View";

    // LogView-specific private fields (verbatim from today's LogViewModel):
    private pendingDialogs = new Map<string, { resolve: (result: LogEntry) => void }>();
    private readonly document = new JsonlLogDocument();
    private heightCache = new Map<string, number>();
    private dirtyIndices = new Set<number>();

    constructor(
        state: TComponentState<LogViewEditorState>,
        private readonly options: { readonly reportDialogAnswered: LogViewDialogAnswerReporter },
    ) {
        super(state);
    }

    focus(): void {
        this.queue.send({ type: "focus" });
    }

    // ── Three-phase lifecycle ──────────────────────────────────────────

    adoptHost(host: TextFileModel): void {
        super.adoptHost(host);

        // LV4 + LV6 — re-parse incrementally on external content changes; the
        // base's echo guard protects against the editor's own self-writes.
        this.subscribeHostContent((content) => this.loadContentIncremental(content));

        // HS1 — seed `showTimestamps` from host slot (sync, no flicker) and
        // mirror changes back. `itemsState` is intentionally NOT seeded — it's
        // transient per the size carve-out. Slice-subscribe keeps the mirror
        // from firing on `itemsState` mutations (the dominant write source on
        // log pages) — only the bounded boolean actually triggers a host-slot write.
        this.mirrorHostSettings<LogViewSettings>(
            (saved) => {
                if (saved.showTimestamps !== undefined) {
                    this.state.update((s) => {
                        s.showTimestamps = saved.showTimestamps;
                    });
                }
            },
            (s) => ({ showTimestamps: s.showTimestamps }),
            (s) => s.showTimestamps,
        );
    }

    protected onHostAttached(host: TextFileModel): void {
        // Initial parse against the adopted host content (switch/restore/open paths).
        this.loadContent(host.state.get().content ?? "");
    }

    // ── JSONL parse (verbatim from today's LogViewModel) ────────────────

    /** Full parse of JSONL content. Used on initial load and when incremental fails. */
    loadContent(content: string): void {
        const { error } = this.document.parse(content);
        this.state.update((s) => {
            s.renderChange = "all";
            s.entriesVersion += 1;
            s.entryCount = this.document.entryCount;
            s.error = error;
        });
    }

    /**
     * Incremental parse: if only new lines were appended, parse only those.
     * Falls back to full parse if existing lines changed.
     */
    private loadContentIncremental(content: string): void {
        const result = this.document.appendIncremental(content);
        if (result.kind === "full") {
            this.state.update((s) => {
                s.renderChange = "all";
                s.entriesVersion += 1;
                s.entryCount = this.document.entryCount;
                s.error = result.error;
            });
            return;
        }
        if (result.newEntries.length > 0) {
            this.state.update((s) => {
                s.renderChange = { from: result.firstNewEntry, to: this.document.entryCount };
                s.entriesVersion += 1;
                s.entryCount = this.document.entryCount;
                if (result.error) s.error = result.error;
            });
        } else if (result.error) {
            this.state.update((s) => {
                s.error = result.error;
            });
        }
    }

    // ── Content serialization ───────────────────────────────────────────

    /** Append a single entry as a JSONL line to host content. */
    private appendToContent(entry: LogEntry): void {
        if (!this._host) return;
        const currentContent = this._host.state.get().content;
        this.writeToHost(this.document.serializeAppend(currentContent ?? "", entry));
    }

    /** Re-serialize a single entry's line in the host content. */
    private updateEntryInContent(entry: LogEntry): void {
        if (!this._host) return;
        const content = this._host.state.get().content;
        const lines = content.split("\n");
        if (this.document.serializeEntry(entry.id, entry, lines)) {
            this.writeToHost(lines.join("\n"));
        }
    }

    /** Debounced flush of dirty entries to JSONL content. */
    private flushDirtyDebounced = debounce(() => {
        if (!this._host) return;
        if (this.dirtyIndices.size === 0) return;
        const content = this._host.state.get().content;
        const lines = content.split("\n");
        const changed = this.document.serializeDirtyEntries(this.dirtyIndices, lines);
        this.dirtyIndices.clear();

        if (changed) {
            this.writeToHost(lines.join("\n"));
        }
    }, 300);

    // ── Entry mutators (public API preserved verbatim per LV9 / MI6) ────

    /** Add a log entry and append it to the host content.
     *  If `fields.id` matches an existing entry, updates it in-place (upsert). */
    addEntry(type: string, fields: StyledText | Record<string, unknown>): LogEntry {
        const fieldsObj = typeof fields === "object" && fields !== null && !Array.isArray(fields)
            ? (fields as Record<string, unknown>)
            : null;
        const id = fieldsObj?.id != null ? String(fieldsObj.id) : this.document.nextEntryId();
        this.document.observeEntryId(id);

        // Upsert: if entry with this ID already exists, update it in-place
        if (fieldsObj?.id != null) {
            const existingIndex = this.document.getEntryIndexById(id);
            if (existingIndex >= 0) {
                const existing = this.document.getEntryAt(existingIndex)!;
                this.document.replaceEntry(existingIndex, { ...existing, ...fieldsObj, type, id });
                this.state.update((s) => {
                    s.renderChange = [existingIndex];
                    s.entriesVersion += 1;
                });
                const updatedEntry = this.document.getEntryAt(existingIndex)!;
                this.updateEntryInContent(updatedEntry);
                this.heightCache.delete(id);
                return updatedEntry;
            }
        }

        // For log entries, fields is StyledText → wrap as { text }
        // For dialog/output entries, fields is already an object → spread
        const entry: LogEntry = fieldsObj
            ? { type, id, ...fieldsObj, timestamp: Date.now() }
            : { type, id, text: fields as StyledText, timestamp: Date.now() };

        const firstNewEntry = this.document.entryCount;
        this.document.appendEntry(entry);
        this.state.update((s) => {
            s.renderChange = { from: firstNewEntry, to: this.document.entryCount };
            s.entriesVersion += 1;
            s.entryCount = this.document.entryCount;
        });

        this.appendToContent(entry);
        return entry;
    }

    /** Register a dialog entry and its resolver for the public dialog APIs. */
    private registerDialogEntry(type: string, fields: Record<string, unknown>): {
        entry: LogEntry;
        promise: Promise<LogEntry>;
    } {
        const entry = this.addEntry(type, fields);
        // LV5 — replaces today's forceScrollVersion bump.
        this.queue.send({ type: "scrollToBottom" });
        const promise = new Promise<LogEntry>((resolve) => {
            this.pendingDialogs.set(entry.id, { resolve });
        });
        return { entry, promise };
    }

    /** Add a dialog entry and return a Promise that resolves when the user responds. */
    addDialogEntry(type: string, fields: Record<string, unknown>): Promise<LogEntry> {
        return this.registerDialogEntry(type, fields).promise;
    }

    addDialogEntryNonBlocking(type: string, fields: Record<string, unknown>): string {
        const { entry, promise } = this.registerDialogEntry(type, fields);
        void promise;
        return entry.id;
    }

    /** Resolve a pending dialog with its stable id and displayed answer label. */
    resolveDialog(id: string, button: string, buttonLabel = button): void {
        const entry = this.document.getEntryById(id);
        if (entry) {
            entry.button = button;
            entry.buttonLabel = buttonLabel;
            this.options.reportDialogAnswered(this.page?.id, entry.id, button);
            const index = this.document.getEntryIndexById(id);
            this.state.update((s) => {
                s.renderChange = [index];
                s.entriesVersion += 1;
            });
        }

        const updatedEntry = this.document.getEntryById(id);
        if (updatedEntry) {
            this.updateEntryInContent(updatedEntry);
        }

        const pending = this.pendingDialogs.get(id);
        if (pending) {
            pending.resolve(updatedEntry);
            this.pendingDialogs.delete(id);
        }
    }

    /** Update an entry's text by ID. Serializes immediately to prevent
     *  the host-subscription race that would overwrite in-memory styled data
     *  with stale JSONL content. */
    updateEntryText(id: string, text: StyledText): void {
        const index = this.document.getEntryIndexById(id);
        if (index < 0) return;

        this.document.replaceEntry(index, { ...this.document.getEntryAt(index)!, text });
        this.state.update((s) => {
            s.renderChange = [index];
            s.entriesVersion += 1;
        });

        const updatedEntry = this.document.getEntryAt(index);
        if (updatedEntry) {
            this.updateEntryInContent(updatedEntry);
        }
    }

    /** Update entry at index via updater. Marks dirty for debounced JSONL serialization. */
    updateEntryAt(index: number, updater: (draft: LogEntry) => void): void {
        updater(this.document.getEntryAt(index)!);
        this.state.update((s) => {
            s.renderChange = [index];
            s.entriesVersion += 1;
        });
        this.dirtyIndices.add(index);
        this.flushDirtyDebounced();
    }

    /** Update an entry by ID. Finds the entry and delegates to updateEntryAt. */
    updateEntryById(id: string, updater: (draft: LogEntry) => void): void {
        const index = this.document.getEntryIndexById(id);
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

        this.document.reset();

        this.state.update((s) => {
            s.renderChange = "all";
            s.entriesVersion += 1;
            s.entryCount = 0;
            s.error = undefined;
        });

        this.writeToHost("");
    };

    toggleTimestamps = (): void => {
        this.state.update((s) => {
            s.showTimestamps = !s.showTimestamps;
        });
    };

    // ── Queries ─────────────────────────────────────────────────────────

    isDialogPending(id: string): boolean {
        return this.pendingDialogs.has(id);
    }

    get entryCount(): number {
        return this.state.get().entryCount;
    }

    getEntryAt(index: number): LogEntry | undefined {
        return this.document.getEntryAt(index);
    }

    /** Return deep copies of the parsed entries; callers cannot mutate model state. */
    getEntriesSnapshot(): LogEntry[] {
        return this.document.getEntries().map((entry) => copyLogValue(entry) as LogEntry);
    }

    /** Return a deep copy of one parsed entry, if it still exists. */
    getEntrySnapshotById(id: string): LogEntry | undefined {
        const entry = this.document.getEntryById(id);
        return entry ? copyLogValue(entry) as LogEntry : undefined;
    }

    /** Whether parsed in-memory entries contain an unanswered inline dialog. */
    hasUnresolvedDialogs(): boolean {
        return this.document.getEntries().some((entry) => isDialogEntry(entry) && !isDialogResolved(entry));
    }

    // ── Height cache (view virtualization — preserves across remounts) ──

    getEntryHeight(id: string): number | undefined {
        return this.heightCache.get(id);
    }

    setEntryHeight(id: string, height: number): void {
        this.heightCache.set(id, height);
    }

    // ── Per-item auxiliary state ────────────────────────────────────────

    getItemState(id: string): Record<string, unknown> {
        return this.state.get().itemsState[id] ?? {};
    }

    setItemState(id: string, patch: Record<string, unknown>): void {
        this.state.update((s) => {
            s.itemsState[id] = { ...s.itemsState[id], ...patch };
        });
        // No persistence — itemsState is transient in-session reactive state
        // per the HS1 size carve-out. The HS1 mirror subscription is
        // slice-scoped to `showTimestamps`, so this mutation doesn't trigger
        // a host-slot write.
    }

    // ── Save / release / dispose ────────────────────────────────────────

    async dispose(): Promise<void> {
        // LV7 — cancel pending dialogs (sentinel resolve; preserved from
        // today's onDispose). Fires for BOTH page-close AND switch-out.
        for (const [id, { resolve }] of this.pendingDialogs.entries()) {
            resolve({ type: "", id, timestamp: 0 });
        }
        this.pendingDialogs.clear();
        this.dirtyIndices.clear();

        await super.dispose();
    }
}
