import * as monaco from "monaco-editor";
import { fs } from "../../api/fs";
import { subscribe as subscribePathWatch } from "../../api/path-watch";
import { ui } from "../../api/ui";
import { t } from "../../../shared/i18n/t";
import { errMessage } from "../../../shared/utils";
import type { PathWatchBatch } from "../../../ipc/api-types";
import { fpExtname, fpNormalizeForCompare } from "../../core/utils/file-path";
import {
    TS_PROJECT_MAX_JSON_BYTES,
    TS_PROJECT_MAX_SOURCE_BYTES,
    canonicalizeProjectPath,
    classifyProjectFile,
    enumerateProjectFiles,
} from "../../api/ts-project-files";
import { tsProjectRegistry, type TsProject, type TsProjectChange } from "../../api/ts-project-registry";
import type { MonacoEditorHostView } from "./MonacoEditorHostView";

// Project IntelliSense (US-1744): a registered TypeScript project folder is loaded lazily as extra libs
// at real file URIs into Monaco's single TS worker, while a page edits a `.ts` file under it.

// ── Tuning constants ─────────────────────────────────────────────────────────
/** Debounce of the project folder watcher. */
const PROJECT_WATCH_DEBOUNCE_MS = 300;
/** Delay before a coalesced full re-enumeration runs. */
const PROJECT_REFRESH_DELAY_MS = 200;

interface FileEntry {
    path: string;
    kind: "source" | "json";
    uri: string;
    /** Extra-lib text currently registered (or last registered); undefined while open as a model. */
    libText?: string;
    lib?: monaco.IDisposable;
}

interface LoadedProject {
    project: TsProject;
    retainers: Set<ProjectPageBindingImpl>;
    files: Map<string, FileEntry>;
    watchUnsub?: () => void;
    disposed: boolean;
    refreshTimer?: ReturnType<typeof setTimeout>;
    refreshing: boolean;
    refreshAgain: boolean;
}

export interface ProjectPageBinding {
    /** Save As / rename / language change. */
    update(next: { filePath?: string; language?: string }): void;
    /** This page's model belongs to a loaded project. */
    readonly active: boolean;
    subscribe(listener: (active: boolean) => void): () => void;
    dispose(): void;
}

const loadedProjects = new Map<string, LoadedProject>();
const bindings = new Set<ProjectPageBindingImpl>();

function isProjectLanguageFile(filePath: string | undefined, language: string | undefined): filePath is string {
    if (!filePath || language !== "typescript") return false;
    const extension = fpExtname(filePath).toLowerCase();
    return extension === ".ts" || extension === ".tsx";
}

function toUri(filePath: string): monaco.Uri {
    return monaco.Uri.file(filePath.replace(/\\/g, "/"));
}

/** The file URI a page's model should have, when its file belongs to a registered project. */
export function projectModelUri(filePath: string | undefined, language: string | undefined): monaco.Uri | undefined {
    if (!isProjectLanguageFile(filePath, language)) return undefined;
    const project = tsProjectRegistry.findForFile(filePath);
    return project ? toUri(canonicalizeProjectPath(project, filePath)) : undefined;
}

function sourceLibText(text: string): string {
    return text;
}

function jsonLibText(text: string): string | undefined {
    const body = text.replace(/^\uFEFF/, "");
    try {
        JSON.parse(body);
    } catch {
        return undefined; // tsc would error on it too
    }
    return `export default ${body};`;
}

function typescriptDefaults(): monaco.typescript.LanguageServiceDefaults {
    return monaco.typescript.typescriptDefaults;
}

function entryUri(filePath: string, kind: "source" | "json"): string {
    const uri = toUri(filePath).toString();
    return kind === "json" ? `${uri}.ts` : uri;
}

function modelExistsFor(entry: FileEntry): boolean {
    // JSON entries live at `<json uri>.ts`; no page model ever has that URI.
    return entry.kind === "source" && !!monaco.editor.getModel(monaco.Uri.parse(entry.uri));
}

function dropLib(entry: FileEntry): void {
    entry.lib?.dispose();
    entry.lib = undefined;
    entry.libText = undefined;
}

/** Register (or refresh) one file. A file open as a model is never also an extra lib. */
function registerFile(loaded: LoadedProject, entry: FileEntry, text: string): void {
    if (loaded.disposed) return;
    if (modelExistsFor(entry)) {
        dropLib(entry);
        return;
    }
    const libText = entry.kind === "json" ? jsonLibText(text) : sourceLibText(text);
    if (libText === undefined) {
        dropLib(entry);
        return;
    }
    if (entry.lib && entry.libText === libText) return;
    // Same key + different content: the previous disposable turns inert, so replace without disposing it.
    entry.lib = typescriptDefaults().addExtraLib(libText, entry.uri);
    entry.libText = libText;
}

async function readProjectFile(filePath: string, kind: "source" | "json"): Promise<string | undefined> {
    try {
        const text = await fs.read(filePath);
        const limit = kind === "json" ? TS_PROJECT_MAX_JSON_BYTES : TS_PROJECT_MAX_SOURCE_BYTES;
        return text.length > limit ? undefined : text;
    } catch {
        return undefined;
    }
}

function removeEntry(loaded: LoadedProject, entry: FileEntry): void {
    dropLib(entry);
    loaded.files.delete(entry.uri);
    loaded.project.knownPaths.delete(fpNormalizeForCompare(entry.path));
}

async function upsertFile(loaded: LoadedProject, filePath: string, kind: "source" | "json"): Promise<void> {
    const text = await readProjectFile(filePath, kind);
    if (loaded.disposed) return;
    const uri = entryUri(filePath, kind);
    const existing = loaded.files.get(uri);
    if (text === undefined) {
        if (existing && !modelExistsFor(existing)) removeEntry(loaded, existing);
        return;
    }
    const entry = existing ?? { path: filePath, kind, uri };
    loaded.files.set(uri, entry);
    loaded.project.knownPaths.set(fpNormalizeForCompare(filePath), filePath);
    registerFile(loaded, entry, text);
}

async function loadAll(loaded: LoadedProject, notifyTruncation: boolean): Promise<void> {
    const set = await enumerateProjectFiles(loaded.project);
    if (loaded.disposed) return;
    // Pages opened with a differently-cased path now know the on-disk spelling: re-point their models first.
    for (const binding of [...loaded.retainers]) binding.reconcile();
    const wanted = new Map<string, { path: string; kind: "source" | "json" }>();
    for (const filePath of set.sources) wanted.set(entryUri(filePath, "source"), { path: filePath, kind: "source" });
    for (const filePath of set.jsons) wanted.set(entryUri(filePath, "json"), { path: filePath, kind: "json" });
    for (const entry of [...loaded.files.values()]) {
        if (!wanted.has(entry.uri) && !modelExistsFor(entry)) removeEntry(loaded, entry);
    }
    for (const [, item] of wanted) {
        await upsertFile(loaded, item.path, item.kind);
        if (loaded.disposed) return;
    }
    if (notifyTruncation && set.truncated) {
        const count = loaded.files.size;
        void ui.notify(t("api.tsProjectTruncated", { count }), "warning");
    }
}

function scheduleRefresh(loaded: LoadedProject): void {
    if (loaded.disposed) return;
    if (loaded.refreshTimer) clearTimeout(loaded.refreshTimer);
    loaded.refreshTimer = setTimeout(() => {
        loaded.refreshTimer = undefined;
        void runRefresh(loaded);
    }, PROJECT_REFRESH_DELAY_MS);
}

async function runRefresh(loaded: LoadedProject): Promise<void> {
    if (loaded.refreshing) {
        loaded.refreshAgain = true;
        return;
    }
    loaded.refreshing = true;
    try {
        await loadAll(loaded, false);
    } catch (error: unknown) {
        console.warn(`TypeScript project refresh failed: ${errMessage(error)}`);
    } finally {
        loaded.refreshing = false;
        if (loaded.refreshAgain && !loaded.disposed) {
            loaded.refreshAgain = false;
            scheduleRefresh(loaded);
        }
    }
}

function removeUnder(loaded: LoadedProject, normalizedPath: string): void {
    for (const entry of [...loaded.files.values()]) {
        const key = fpNormalizeForCompare(entry.path);
        if (key === normalizedPath || key.startsWith(`${normalizedPath}/`)) {
            if (modelExistsFor(entry)) dropLib(entry);
            else removeEntry(loaded, entry);
        }
    }
}

async function applyPathChange(loaded: LoadedProject, changePath: string, deleted: boolean): Promise<void> {
    if (deleted) {
        removeUnder(loaded, fpNormalizeForCompare(changePath));
        return;
    }
    const kind = classifyProjectFile(loaded.project, changePath);
    if (kind) {
        await upsertFile(loaded, changePath, kind);
    } else if (!fpExtname(changePath)) {
        scheduleRefresh(loaded); // a created/moved-in folder: enumerate its files
    }
}

async function onWatchBatch(loaded: LoadedProject, batch: PathWatchBatch): Promise<void> {
    if (loaded.disposed) return;
    if (batch.ended) {
        loaded.watchUnsub = undefined;
        scheduleRefresh(loaded);
        return;
    }
    if (batch.rescan) {
        scheduleRefresh(loaded);
        return;
    }
    const tsconfigKey = fpNormalizeForCompare(loaded.project.tsconfigPath);
    for (const change of batch.changes) {
        if (loaded.disposed) return;
        if (fpNormalizeForCompare(change.path) === tsconfigKey) {
            await tsProjectRegistry.reload(loaded.project); // emits "changed" on a real change, which refreshes
            continue;
        }
        if (change.type === "moved") {
            await applyPathChange(loaded, change.path, true);
            await applyPathChange(loaded, change.to, false);
        } else {
            await applyPathChange(loaded, change.path, change.type === "deleted");
        }
    }
}

function startLoad(loaded: LoadedProject): void {
    loaded.watchUnsub = subscribePathWatch(loaded.project.root, (batch) => {
        void onWatchBatch(loaded, batch).catch((error: unknown) => {
            console.warn(`TypeScript project watch failed: ${errMessage(error)}`);
        });
    }, {
        recursive: true,
        debounceMs: PROJECT_WATCH_DEBOUNCE_MS,
        // eslint-disable-next-line vanilla-view/no-hardcoded-ui-strings -- Diagnostic label, not user-facing text.
        label: "ts project",
    });
    void loadAll(loaded, true).catch((error: unknown) => {
        console.warn(`TypeScript project load failed: ${errMessage(error)}`);
    });
}

function unload(loaded: LoadedProject): void {
    if (loaded.disposed) return;
    loaded.disposed = true;
    if (loaded.refreshTimer) clearTimeout(loaded.refreshTimer);
    loaded.watchUnsub?.();
    loaded.watchUnsub = undefined;
    for (const entry of loaded.files.values()) dropLib(entry);
    loaded.files.clear();
    loadedProjects.delete(loaded.project.key);
    const retainers = [...loaded.retainers];
    loaded.retainers.clear();
    retainers.forEach((binding) => binding.refreshActive());
}

function retain(project: TsProject, binding: ProjectPageBindingImpl): void {
    let loaded = loadedProjects.get(project.key);
    if (loaded && loaded.project !== project) {
        unload(loaded); // a re-registered project object replaced the old one
        loaded = undefined;
    }
    if (!loaded) {
        loaded = {
            project,
            retainers: new Set(),
            files: new Map(),
            disposed: false,
            refreshing: false,
            refreshAgain: false,
        };
        loadedProjects.set(project.key, loaded);
        loaded.retainers.add(binding);
        startLoad(loaded);
        return;
    }
    loaded.retainers.add(binding);
}

function release(project: TsProject, binding: ProjectPageBindingImpl): void {
    const loaded = loadedProjects.get(project.key);
    if (!loaded || loaded.project !== project) return;
    loaded.retainers.delete(binding);
    if (loaded.retainers.size === 0) unload(loaded);
}

function findEntry(model: monaco.editor.ITextModel): { loaded: LoadedProject; entry: FileEntry } | undefined {
    if (model.uri.scheme !== "file") return undefined;
    const uri = model.uri.toString();
    for (const loaded of loadedProjects.values()) {
        const entry = loaded.files.get(uri);
        if (entry) return { loaded, entry };
    }
    return undefined;
}

// Module-lifetime Monaco subscriptions (documented exception, like configure-monaco.ts):
// a file open as a model is never also an extra lib; it returns to the extra-lib set when its model closes.
monaco.editor.onDidCreateModel((model) => {
    const found = findEntry(model);
    if (found) dropLib(found.entry);
});
monaco.editor.onWillDisposeModel((model) => {
    const found = findEntry(model);
    if (!found) return;
    const { loaded, entry } = found;
    setTimeout(() => {
        if (loaded.disposed || loaded.files.get(entry.uri) !== entry) return;
        if (monaco.editor.getModel(model.uri)) return;
        // Unsaved edits die with the model, so disk is the truth.
        void upsertFile(loaded, entry.path, entry.kind);
    }, 0);
});

// Module-lifetime registry subscription: boards register/unregister projects at any time.
tsProjectRegistry.subscribe((change: TsProjectChange) => {
    const loaded = loadedProjects.get(change.project.key);
    if (change.type === "removed") {
        if (loaded && loaded.project === change.project) unload(loaded);
        return;
    }
    if (change.type === "changed") {
        if (loaded && loaded.project === change.project) scheduleRefresh(loaded);
        return;
    }
    for (const binding of [...bindings]) binding.reconcile(true);
});

class ProjectPageBindingImpl implements ProjectPageBinding {
    private project: TsProject | undefined;
    private state: { filePath?: string; language?: string };
    private lastActive = false;
    private readonly listeners = new Set<(active: boolean) => void>();
    private disposed = false;

    public constructor(
        private readonly host: MonacoEditorHostView,
        initial: { filePath?: string; language?: string },
        private readonly onModelReplaced: () => void,
    ) {
        this.state = initial;
        bindings.add(this);
        this.reconcile();
    }

    public get active(): boolean {
        if (this.disposed || !this.project || !this.host.isReady || !this.host.getFileModelUri()) return false;
        const loaded = loadedProjects.get(this.project.key);
        return !!loaded && !loaded.disposed && loaded.project === this.project && loaded.retainers.has(this);
    }

    public update(next: { filePath?: string; language?: string }): void {
        this.state = next;
        this.reconcile();
    }

    /**
     * Re-evaluate project membership and the model URI. `fromRegistry` never downgrades: when a project
     * is removed the model keeps its file URI (decision 4); only the page's own changes downgrade.
     */
    public reconcile(fromRegistry = false): void {
        if (this.disposed) return;
        const { filePath, language } = this.state;
        const project = isProjectLanguageFile(filePath, language) ? tsProjectRegistry.findForFile(filePath) : undefined;
        if (fromRegistry && !project) return;
        if (project !== this.project) {
            if (this.project) release(this.project, this);
            this.project = project;
            if (project) retain(project, this);
        } else if (project) {
            const loaded = loadedProjects.get(project.key);
            if (!loaded || !loaded.retainers.has(this)) retain(project, this);
        }
        if (this.host.isReady) {
            const desired = project && filePath ? toUri(canonicalizeProjectPath(project, filePath)) : undefined;
            const current = this.host.getFileModelUri();
            if (desired?.toString() !== current?.toString()) {
                this.host.replaceModelUri(desired);
                this.onModelReplaced();
            }
        }
        this.refreshActive();
    }

    public refreshActive(): void {
        const active = this.active;
        if (active === this.lastActive) return;
        this.lastActive = active;
        for (const listener of [...this.listeners]) listener(active);
    }

    public subscribe(listener: (active: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        bindings.delete(this);
        if (this.project) release(this.project, this);
        this.project = undefined;
        this.listeners.clear();
    }
}

/** Bind a Monaco host view to the project that owns its file (retain/release + model URI). */
export function bindProjectPage(
    host: MonacoEditorHostView,
    initial: { filePath?: string; language?: string },
    onModelReplaced: () => void = () => undefined,
): ProjectPageBinding {
    return new ProjectPageBindingImpl(host, initial, onModelReplaced);
}
