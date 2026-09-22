import { TComponentState } from "../../core/state/state";
import {
    TextFileModel,
    getDefaultTextFileEditorModelState,
} from "../../editors/text/TextEditorModel";
import { errMessage } from "../../../shared/utils";
import { fs } from "../fs";
import type { BoardSettingValue, BoardSettingsChange, BoardSettingsFile } from "./types";

type BoardSettingsListener = (change: BoardSettingsChange) => void;

function isSettingValue(value: unknown): value is BoardSettingValue {
    return typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function parseSettingsFile(text: string): BoardSettingsFile {
    let parsed: unknown;
    try {
        parsed = text.trim() ? JSON.parse(text) : {};
    } catch (error: unknown) {
        throw new Error(`The board settings file contains invalid JSON: ${errMessage(error)}`);
    }
    if (!isPlainObject(parsed)) {
        throw new Error("The board settings file must contain a namespace object.");
    }

    const file: BoardSettingsFile = {};
    for (const [namespace, rawSettings] of Object.entries(parsed)) {
        if (!isPlainObject(rawSettings)) {
            throw new Error(`Board settings namespace ${JSON.stringify(namespace)} must be an object.`);
        }
        const settings: Record<string, BoardSettingValue> = {};
        for (const [id, value] of Object.entries(rawSettings)) {
            if (!isSettingValue(value)) {
                throw new Error(`Board setting ${JSON.stringify(id)} in ${JSON.stringify(namespace)} must be a string, number, or boolean.`);
            }
            settings[id] = value;
        }
        file[namespace] = settings;
    }
    return file;
}

function sameValue(left: BoardSettingValue | undefined, right: BoardSettingValue | undefined): boolean {
    return left === right;
}

function changedSettings(previous: BoardSettingsFile, next: BoardSettingsFile): BoardSettingsChange[] {
    const changes: BoardSettingsChange[] = [];
    const namespaces = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const namespace of namespaces) {
        const previousSettings = previous[namespace] ?? {};
        const nextSettings = next[namespace] ?? {};
        const ids = new Set([...Object.keys(previousSettings), ...Object.keys(nextSettings)]);
        for (const id of ids) {
            const previousValue = previousSettings[id];
            const nextValue = nextSettings[id];
            if (!sameValue(previousValue, nextValue)) {
                changes.push({ namespace, id, value: nextValue });
            }
        }
    }
    return changes;
}

/** Renderer-lifetime plaintext store for the single board-settings.json file. */
class BoardSettingsStore {
    private model: TextFileModel | null = null;
    private loadedPath: string | null = null;
    private parsed: BoardSettingsFile = {};
    private loadError: string | undefined;
    private queue: Promise<unknown> = Promise.resolve();
    private readonly listeners = new Set<BoardSettingsListener>();
    private modelSubscription: (() => void) | undefined;

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.queue.then(operation);
        this.queue = run.then(
            (): void => undefined,
            (): void => undefined,
        );
        return run;
    }

    private notify(changes: readonly BoardSettingsChange[]): void {
        for (const change of changes) {
            for (const listener of this.listeners) {
                try {
                    listener(change);
                } catch (error: unknown) {
                    console.error("Board settings change listener failed:", errMessage(error));
                }
            }
        }
    }

    private async ensureLoaded(): Promise<void> {
        await fs.wait();
        const filePath = fs.resolveDataPath("board-settings.json");
        if (this.loadedPath === filePath && this.loadError) throw new Error(this.loadError);
        if (this.loadedPath === filePath && this.model) return;

        if (this.loadedPath !== filePath) {
            this.disposeModel();
            this.loadedPath = filePath;
            this.parsed = {};
            this.loadError = undefined;
        }

        if (!(await fs.exists(filePath))) return;

        const model = new TextFileModel(new TComponentState({
            ...getDefaultTextFileEditorModelState(),
            filePath,
            language: "json",
        }));
        model.skipSave = true;
        await model.restore();
        try {
            const parsed = parseSettingsFile(model.state.get().content || "");
            this.parsed = parsed;
            this.loadError = undefined;
            this.model = model;
            this.modelSubscription = model.state.subscribe(
                () => { void this.enqueue(() => this.reloadFromModel()); },
                (state) => state.content,
            );
        } catch (error: unknown) {
            await model.dispose();
            this.loadError = `Failed to load board settings: ${errMessage(error)}`;
            throw new Error(this.loadError);
        }
    }

    private async reloadFromModel(): Promise<void> {
        const model = this.model;
        if (!model) return;
        try {
            const next = parseSettingsFile(model.state.get().content || "");
            const changes = changedSettings(this.parsed, next);
            this.parsed = next;
            this.loadError = undefined;
            if (changes.length > 0) this.notify(changes);
        } catch (error: unknown) {
            this.loadError = `Failed to reload board settings: ${errMessage(error)}`;
        }
    }

    private disposeModel(): void {
        this.modelSubscription?.();
        this.modelSubscription = undefined;
        if (this.model) void this.model.dispose();
        this.model = null;
    }

    private serialize(file: BoardSettingsFile): string {
        return JSON.stringify(file, null, 2) + "\n";
    }

    private async persist(next: BoardSettingsFile): Promise<void> {
        await fs.wait();
        const filePath = fs.resolveDataPath("board-settings.json");
        await fs.write(filePath, this.serialize(next));
        this.parsed = next;
        this.loadError = undefined;
        if (!this.model) await this.ensureLoaded();
    }

    get(namespace: string, id: string): Promise<BoardSettingValue | undefined> {
        return this.enqueue(async () => {
            await this.ensureLoaded();
            return this.parsed[namespace]?.[id];
        });
    }

    set(namespace: string, id: string, value: BoardSettingValue): Promise<void> {
        return this.enqueue(async () => {
            await this.ensureLoaded();
            const next: BoardSettingsFile = JSON.parse(JSON.stringify(this.parsed)) as BoardSettingsFile;
            (next[namespace] ??= {})[id] = value;
            await this.persist(next);
            this.notify([{ namespace, id, value }]);
        });
    }

    unset(namespace: string, id: string): Promise<void> {
        return this.enqueue(async () => {
            await this.ensureLoaded();
            const next: BoardSettingsFile = JSON.parse(JSON.stringify(this.parsed)) as BoardSettingsFile;
            const settings = next[namespace];
            if (settings) {
                delete settings[id];
                if (Object.keys(settings).length === 0) delete next[namespace];
            }
            await this.persist(next);
            this.notify([{ namespace, id }]);
        });
    }

    onChanged(listener: BoardSettingsListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

export const boardSettings = new BoardSettingsStore();
