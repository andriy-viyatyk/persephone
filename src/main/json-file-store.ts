import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SerialQueue } from "../shared/serial-queue";
import { errMessage } from "../shared/utils";
import { getDataFolder } from "./utils";

export interface JsonLoadResult<T> {
    status: "ok" | "missing" | "invalid";
    value: T;
    dirty: boolean;
}

export interface JsonFileStoreOptions<T> {
    validate(raw: unknown, ctx: { markDirty(): void }): T | null;
    defaultValue(): T;
    indent?: number;
    onSaveError?: "throw" | "warn";
}

/**
 * Persists one JSON file in the data folder. A store must use only one write mode:
 * sync stores must never call save(), and async stores must never call saveSync().
 * Validation runs only after an existing file has been read successfully.
 */
export class JsonFileStore<T> {
    private readonly queue = new SerialQueue();

    constructor(readonly fileName: string, private readonly options: JsonFileStoreOptions<T>) {}

    load(): Promise<JsonLoadResult<T>> {
        return this.queue.run(async () => this.loadAsync());
    }

    loadSync(): JsonLoadResult<T> {
        try {
            return this.parse(fs.readFileSync(this.filePath(), "utf8"));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.defaultResult("missing");
            return this.invalid(error);
        }
    }

    save(value: T): Promise<void> {
        return this.queue.run(async () => {
            try {
                await this.writeAsync(this.serialize(value));
            } catch (error) {
                this.handleSaveError(error);
            }
        });
    }

    saveSync(value: T): void {
        try {
            const filePath = this.filePath();
            const directory = path.dirname(filePath);
            const temporary = this.tempPath(filePath);
            fs.mkdirSync(directory, { recursive: true });
            try {
                fs.writeFileSync(temporary, this.serialize(value), { encoding: "utf8", flag: "wx" });
                fs.renameSync(temporary, filePath);
            } catch (error) {
                try { fs.rmSync(temporary, { force: true }); } catch { /* Best effort cleanup. */ }
                throw error;
            }
        } catch (error) {
            this.handleSaveError(error);
        }
    }

    private async loadAsync(): Promise<JsonLoadResult<T>> {
        try {
            return this.parse(await fs.promises.readFile(this.filePath(), "utf8"));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.defaultResult("missing");
            return this.invalid(error);
        }
    }

    private parse(text: string): JsonLoadResult<T> {
        let dirty = false;
        try {
            const raw: unknown = JSON.parse(text);
            const value = this.options.validate(raw, { markDirty: () => { dirty = true; } });
            if (value === null) throw new Error("JSON file validation failed.");
            return { status: "ok", value, dirty };
        } catch (error) {
            return this.invalid(error);
        }
    }

    private invalid(error: unknown): JsonLoadResult<T> {
        console.warn(`[JsonFileStore] ${this.fileName}: ${errMessage(error)}`);
        return this.defaultResult("invalid");
    }

    private defaultResult(status: "missing" | "invalid"): JsonLoadResult<T> {
        return { status, value: this.options.defaultValue(), dirty: false };
    }

    private serialize(value: T): string {
        return JSON.stringify(value, null, this.options.indent ?? 2);
    }

    private filePath(): string {
        return path.join(getDataFolder(), this.fileName);
    }

    private tempPath(filePath: string): string {
        return path.join(path.dirname(filePath), `${this.fileName}.${process.pid}.${randomUUID()}.tmp`);
    }

    private async writeAsync(text: string): Promise<void> {
        const filePath = this.filePath();
        const directory = path.dirname(filePath);
        const temporary = this.tempPath(filePath);
        await fs.promises.mkdir(directory, { recursive: true });
        let handle: fs.promises.FileHandle | undefined;
        try {
            handle = await fs.promises.open(temporary, "wx");
            await handle.writeFile(text, "utf8");
            await handle.close();
            handle = undefined;
            await fs.promises.rename(temporary, filePath);
        } catch (error) {
            await handle?.close().catch((): undefined => undefined);
            await fs.promises.rm(temporary, { force: true }).catch((): undefined => undefined);
            throw error;
        }
    }

    private handleSaveError(error: unknown): void {
        if ((this.options.onSaveError ?? "throw") === "warn") {
            console.warn(`[JsonFileStore] ${this.fileName}: save failed: ${errMessage(error)}`);
            return;
        }
        throw error;
    }
}
