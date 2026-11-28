import { TComponentState } from "../../core/state/state";
import {
    TextFileModel,
    getDefaultTextFileEditorModelState,
} from "../../editors/content-host/TextFileModel";
import { shell } from "../shell";
import { t } from "../../../shared/i18n/t";
import { ui } from "../ui";
import { fs } from "../fs";
import { settings } from "../settings";
import {
    BoardVarsFile,
    BoardVarsLoadResult,
    DEFAULT_PROFILE,
    parseBoardVarsText,
} from "./types";
import { errMessage } from "../../../shared/utils";

// =============================================================================
// BoardEnvStore.
//
// Session-singleton store over the global `.env.json` file (path from the
// `board-vars.file` setting). Mirrors the BrowserBookmarks encrypted-file
// pattern: a standalone TextFileModel restores the file, `ui.password` unlocks
// an encrypted one, and — because `decrypt()` installs a DecryptTransformer on
// the pipe — a later `saveFile()` re-encrypts automatically with no password
// handling here.
//
// The model is kept alive for the session so an unlocked encrypted file stays
// unlocked. Parsing is redone from `model.state.get().content` on every
// `ensureLoaded()` (the file is tiny), so there is no parse cache to invalidate;
// the model's own pipe watch keeps `content` fresh on external edits.
// =============================================================================

class BoardEnvStore {
    private model: TextFileModel | null = null;
    /** Path the current model was built for; null when no model. */
    private loadedPath: string | null = null;
    private parsed: BoardVarsFile = {};
    private started = false;
    private generation = 0;
    private modelLoad?: { path: string; generation: number; promise: Promise<BoardVarsLoadResult> };
    private interactiveLoad?: Promise<BoardVarsLoadResult>;
    private decryptPrompt?: Promise<BoardVarsLoadResult>;
    private createPrompt?: Promise<boolean>;

    start(): void {
        if (this.started) return;
        this.started = true;
        // This session singleton owns the setting listener for the renderer lifetime;
        // no view/model instance should dispose it.
        // Drop the model when the configured path changes so the next call reloads.
        settings.watch("board-vars.file", () => this.reset());
    }

    /** The path most recently resolved by `ensureLoaded()` — lets `persephone.var.show()` open
     *  the file without the editor itself needing to know about the `board-vars.file` setting
     *. Empty when never loaded. */
    get filePath(): string {
        return this.loadedPath ?? "";
    }

    private reset(): void {
        this.generation++;
        this.interactiveLoad = undefined;
        this.decryptPrompt = undefined;
        void this.model?.dispose();
        this.model = null;
        this.loadedPath = null;
        this.parsed = {};
    }

    /**
     * Idempotent: build/restore the model for the configured path, prompt-and-decrypt if the file
     * is locked (unless `silent`), then parse. Callers run this (and check `status === "ok"`)
     * before the sync accessors.
     */
    async ensureLoaded(opts?: { silent?: boolean }): Promise<BoardVarsLoadResult> {
        if (!opts?.silent && this.interactiveLoad) return this.interactiveLoad;
        if (!opts?.silent) {
            const operation = this.ensureLoadedCore(false);
            this.interactiveLoad = operation;
            try { return await operation; }
            finally { if (this.interactiveLoad === operation) this.interactiveLoad = undefined; }
        }
        return this.ensureLoadedCore(true);
    }

    /** Coalesced create/decrypt flow shared by service and admin callers in this renderer. */
    async ensureInteractiveReady(): Promise<BoardVarsLoadResult> {
        let load = await this.ensureLoaded();
        if (load.status === "not-configured") {
            if (!this.createPrompt) {
                const operation = import("../dialogs/CreateBoardVarsStorageDialog")
                    .then(({ showCreateBoardVarsStorageDialog }) => showCreateBoardVarsStorageDialog())
                    .finally(() => { if (this.createPrompt === operation) this.createPrompt = undefined; });
                this.createPrompt = operation;
            }
            const created = await this.createPrompt;
            if (!created) return { status: "not-configured" };
            load = await this.ensureLoaded();
            if (load.status === "not-configured") {
                return { status: "error", message: "Board environment variables storage could not be loaded after creation." };
            }
        }
        return load;
    }

    private async ensureLoadedCore(silent: boolean): Promise<BoardVarsLoadResult> {
        const path = (settings.get("board-vars.file") || "").trim();
        if (!path) return { status: "not-configured" };
        const generation = this.generation;
        if (this.loadedPath !== path) {
            if (!this.modelLoad || this.modelLoad.path !== path || this.modelLoad.generation !== generation) {
                const promise = this.loadModel(path, generation);
                this.modelLoad = { path, generation, promise };
            }
            const load = this.modelLoad;
            const result = await load.promise;
            if (this.modelLoad === load) this.modelLoad = undefined;
            if (result.status !== "ok") return result;
        }
        const model = this.model;
        if (!model) return { status: "error", message: "No store model" };

        if (shell.encryption.isEncrypted(model.state.get().content || "")) {
            // `decrypted` is true once the password has been entered this session.
            if (!model.decrypted) {
                if (silent) return { status: "locked" };
                if (!this.decryptPrompt) {
                    const decryptModel = model;
                    const loadGeneration = this.generation;
                    const operation = (async (): Promise<BoardVarsLoadResult> => {
                        const password = await ui.password({
                            mode: "decrypt",
                            message: t("api.decryptBoardEnvironmentVariables"),
                        });
                        if (!password) return { status: "locked" };
                        if (loadGeneration !== this.generation || decryptModel !== this.model) return { status: "not-configured" };
                        const ok = await decryptModel.decrypt(password); // toasts on wrong password
                        if (!ok) return { status: "locked" };
                        return { status: "ok" };
                    })().finally(() => { if (this.decryptPrompt === operation) this.decryptPrompt = undefined; });
                    this.decryptPrompt = operation;
                }
                const decrypted = await this.decryptPrompt;
                if (decrypted.status !== "ok") return decrypted;
            }
        }

        if (model !== this.model || generation !== this.generation || path !== (settings.get("board-vars.file") || "").trim()) {
            return { status: "not-configured" };
        }

        try {
            const text = model.state.get().content || "";
            const parsed = parseBoardVarsText(text);
            this.parsed = parsed && typeof parsed === "object" ? parsed as BoardVarsFile : {};
        } catch (e) {
            return { status: "error", message: errMessage(e) };
        }
        return { status: "ok" };
    }

    private async loadModel(path: string, generation: number): Promise<BoardVarsLoadResult> {
        if (!(await fs.exists(path))) return { status: "not-configured" };
        const model = new TextFileModel(
            new TComponentState({
                ...getDefaultTextFileEditorModelState(),
                filePath: path,
                language: "json",
            }),
        );
        model.skipSave = true;
        try {
            await model.restore();
            if (generation !== this.generation || path !== (settings.get("board-vars.file") || "").trim()) {
                await model.dispose();
                return { status: "not-configured" };
            }
            this.resetModelOnly();
            this.model = model;
            this.loadedPath = path;
            return { status: "ok" };
        } catch (error) {
            await model.dispose();
            return { status: "error", message: errMessage(error) };
        }
    }

    private resetModelOnly(): void {
        if (this.model) void this.model.dispose();
        this.model = null;
        this.loadedPath = null;
        this.parsed = {};
    }

    // ── Sync accessors — call ensureLoaded() (status "ok") first ─────────────

    /** A single value from a namespace's profile (`default` when `env` omitted). */
    get(namespace: string, name: string, env?: string): string | undefined {
        const value = this.parsed[namespace]?.[env || DEFAULT_PROFILE]?.[name];
        return typeof value === "string" ? value : undefined;
    }

    /** Key names in a namespace's profile (not values). */
    list(namespace: string, env?: string): string[] {
        return Object.keys(this.parsed[namespace]?.[env || DEFAULT_PROFILE] ?? {});
    }

    /** The whole parsed file returned to the editor. Returns a live reference; do not mutate. */
    getAll(): BoardVarsFile {
        return this.parsed;
    }

    /**
     * Set one value, serialize, and write back. Because the model's pipe holds the
     * DecryptTransformer for an encrypted file, `saveFile()` re-encrypts on disk automatically.
     * Must run after a successful `ensureLoaded()` (which decrypts and builds the model).
     */
    async set(namespace: string, name: string, value: string, env?: string): Promise<void> {
        const model = this.model;
        if (!model) throw new Error("Board vars store is not loaded");
        const profile = env || DEFAULT_PROFILE;
        // Deep clone so the object handed out via getAll() is not mutated in place.
        const next: BoardVarsFile = JSON.parse(JSON.stringify(this.parsed));
        (next[namespace] ??= {});
        (next[namespace][profile] ??= {});
        next[namespace][profile][name] = value;
        this.parsed = next;
        model.changeContent(JSON.stringify(next, null, 4));
        await model.saveFile();
    }

    /** Remove one value from a namespace profile without changing any other profile. */
    async delete(namespace: string, name: string, env?: string): Promise<void> {
        const profile = env || DEFAULT_PROFILE;
        if (this.parsed[namespace]?.[profile]?.[name] === undefined) return;
        const model = this.model;
        if (!model) throw new Error("Board vars store is not loaded");
        const next: BoardVarsFile = JSON.parse(JSON.stringify(this.parsed));
        delete next[namespace]?.[profile]?.[name];
        this.parsed = next;
        model.changeContent(JSON.stringify(next, null, 4));
        await model.saveFile();
    }
}

export const boardVars = new BoardEnvStore();
