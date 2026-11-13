import { EditorId } from "../../../shared/editor-ids";
import type { EditorModelInstance as EditorModel } from "./EditorModel";
import type { EditorDescriptor } from "../../../shared/persistence";
import type { TextFileModel } from "../content-host/TextFileModel";
import type { VanillaViewCtor } from "../../uikit/shared/vanilla-view";
import { monacoLanguages } from "../../core/utils/monaco-languages";
import type { ContentRepresentation } from "../../api/types/capabilities";
import type { MessageKey } from "../../../shared/i18n/en";
import { parseBoardEditorId } from "../../../shared/board/board-editor-id";
import type { EditorView } from "../../../shared/types";
import type { InternalEditorId } from "./editor-ids";
import { CONTENT_DETECTED } from "./editor-matchers";

export type EditorCapabilityDeclaration =
    | { readonly id: "text.open"; readonly representation?: never }
    | { readonly id: "content.view"; readonly representation: ContentRepresentation };

export type Tier = number;

export interface LanguageMatch { valid?: boolean; tier?: Tier }

export interface EditorMatcher {
    file?(name: string): Tier | undefined;
    language?(language: string, name?: string): LanguageMatch | undefined;
    content?(language: string, content: string): boolean;
    folder?(path: string): Tier | undefined;
    host?(host: TextFileModel): Tier | undefined;
}

type MatcherAxis = "host" | "file" | "language" | "content" | "folder";
type RankPurpose = "open-file" | "host-switch" | "language-switch" | "preview" | "language-validation" | "open-folder" | "folder-switch";

interface QueryRule {
    axes: readonly MatcherAxis[]; direction: "ascending" | "descending" | "none";
    selection: "first" | "all" | "last"; ties: "registration-first" | "registration-last" | "none";
    score: "first-tier" | "language-validity";
    requireContentHost?: boolean; excludeMonaco?: boolean; fileGate?: boolean;
}

type RankInput = { purpose: RankPurpose; fileName?: string; folderPath?: string; language?: string;
    host?: TextFileModel; editorId?: string };

interface RankedEditor { id: string; tier: Tier; valid?: boolean }

type EditorModuleCommon = {
    /** Factory for a new editor instance. */
    createEditor(): EditorModel;
    /** Restore one persisted descriptor owned by this editor module. */
    restoreFromDescriptor?(descriptor: EditorDescriptor, context: EditorRestoreContext): Promise<EditorModel | null>;
    /** File-open factory for standalone editors whose construction depends on the path: link decoding
     *  (git-tree, mneme-root, board, toolset, category), path-derived state (image, video), or archive
     *  reading. Editors without it use the default text-host flow. */
    newEditorModel?(filePath?: string): Promise<EditorModel>;
    /** Folder-open factory for standalone editors that use the Explorer-named directory. */
    newEditorModelForFolder?(anchorFolder: string, page?: import("../../api/pages/IPageHost").IPageHost): Promise<EditorModel>;
};

export interface EditorRestoreContext {
    mainEditorId: string | null;
    /** Ask the page to add a folder view rooted at this path. */
    requestFolderFallback(request: { sourceEditorId: string; folderPath: string }): void;
}

export interface EditorRestoreModule {
    restoreFromDescriptor?: (descriptor: EditorDescriptor, context: EditorRestoreContext) => Promise<EditorModel | null>;
}

export type EditorModule<M extends EditorModel = EditorModel> = EditorModuleCommon & {
    View: VanillaViewCtor<{ model: M }>;
};

type EditorModelConstructor<M extends EditorModel> = abstract new (...args: never[]) => M;

function isModelOfType<M extends EditorModel>(
    model: EditorModel,
    ModelClass: EditorModelConstructor<M>,
): model is M {
    return model instanceof ModelClass;
}

/** Adds the single runtime model check at the registry-to-view boundary. */
export function defineEditorModule<M extends EditorModel>(
    ModelClass: EditorModelConstructor<M>,
    definition: EditorModule<M>,
): EditorModule<EditorModel> {
    const TypedView = definition.View;
    // This adapter must preserve the selected view's lifecycle without adding a wrapper view.
    // eslint-disable-next-line vanilla-view/no-indirect-view-subclass
    class CheckedView extends TypedView {
        public constructor(props: { model: EditorModel }) {
            const model = props.model;
            if (!isModelOfType(model, ModelClass)) {
                throw new Error("Editor view received a model of the wrong type.");
            }
            super({ model });
        }
    }

    return { ...definition, View: CheckedView };
}

export interface EditorDefinition {
    id: EditorView | InternalEditorId;
    name: string;
    /** English catalog identity used for localized UI display. */
    readonly nameKey?: MessageKey;
    /** Canonical user guide path for synchronous facade help. */
    readonly guidePath?: string;

    /** Whether the open-file flow creates a host first and inherits it via `switchFrom` / `applyRestoreData`.
     *  Kept explicit during the inert phase; it could be derived from trait introspection at module-load. */
    readonly hasContentHost: boolean;

    /** MCP recovery guidance for `pages.addEditorPage`, which only constructs content-host editors. */
    readonly mcpHint?: string;

    /** Icon token used for a directory claimed by this editor. */
    readonly folderIcon?: string;

    /** Built-in capability declarations served by this editor. */
    readonly capabilities?: readonly EditorCapabilityDeclaration[];

    /** Granular matching rules; absent for standalone editors that do not match files or appear in the switch. */
    match?: EditorMatcher;

    loadModule(): Promise<EditorModule<EditorModel>>;
}

const QUERY_RULES: Record<RankPurpose, QueryRule> = {
    "open-file": { axes: ["file"], direction: "descending", selection: "first", ties: "registration-first", score: "first-tier" },
    "host-switch": {
        axes: ["host", "file", "language", "content"],
        direction: "descending",
        selection: "all",
        ties: "registration-first",
        score: "first-tier",
        requireContentHost: true,
    },
    "language-switch": { axes: ["language"], direction: "ascending", selection: "all", ties: "registration-first", score: "first-tier" },
    preview: {
        axes: ["language"], direction: "ascending", selection: "last", ties: "registration-last", score: "first-tier",
        excludeMonaco: true, fileGate: true,
    },
    "language-validation": {
        axes: ["language"], direction: "none", selection: "first", ties: "none", score: "language-validity",
    },
    "open-folder": { axes: ["folder"], direction: "descending", selection: "first", ties: "registration-first", score: "first-tier" },
    "folder-switch": { axes: ["folder"], direction: "ascending", selection: "all", ties: "registration-first", score: "first-tier" },
};

class EditorRegistry {
    private definitions = new Map<string, EditorDefinition>();
    private modules = new Map<string, EditorModule<EditorModel>>();
    private restoreOnlyLoaders = new Map<string, () => Promise<EditorRestoreModule>>();
    private restoreOnlyModules = new Map<string, EditorRestoreModule>();

    static readonly QUERY_RULES = QUERY_RULES;

    rank(input: RankInput): RankedEditor[] {
        const rule = EditorRegistry.QUERY_RULES[input.purpose];
        const definitions = input.editorId
            ? [this.definitions.get(input.editorId)].filter((def): def is EditorDefinition => !!def)
            : Array.from(this.definitions.values());
        const ranked: RankedEditor[] = [];
        for (const definition of definitions) {
            if (rule.requireContentHost && !definition.hasContentHost) continue;
            if (rule.excludeMonaco && definition.id === EditorId.monaco) continue;
            const matcher = definition.match;
            if (rule.fileGate && matcher?.file && matcher.file(input.fileName ?? "") === undefined) continue;
            let tier: Tier | undefined;
            let valid: boolean | undefined;
            for (const axis of rule.axes) {
                let axisTier: Tier | undefined;
                switch (axis) {
                    case "host": axisTier = input.host ? matcher?.host?.(input.host) : undefined; break;
                    case "file": axisTier = input.fileName ? matcher?.file?.(input.fileName) : undefined; break;
                    case "language": {
                        const match = input.language ? matcher?.language?.(input.language, input.fileName) : undefined;
                        valid = match?.valid;
                        axisTier = match?.tier;
                        break;
                    }
                    case "content": {
                        const state = input.host?.state.get() as { content?: string } | undefined;
                        axisTier = input.host && matcher?.content?.(input.language ?? "", state?.content ?? "")
                            ? CONTENT_DETECTED : undefined;
                        break;
                    }
                    case "folder": axisTier = input.folderPath ? matcher?.folder?.(input.folderPath) : undefined; break;
                }
                if (axisTier !== undefined) { tier = axisTier; break; }
            }
            if (rule.score === "language-validity") ranked.push({ id: definition.id, tier: 0, valid });
            else if (tier !== undefined && tier >= 0) ranked.push({ id: definition.id, tier });
        }
        const sorted = rule.direction === "none" ? ranked : ranked.sort((left, right) =>
            (rule.direction === "ascending" ? 1 : -1) * (left.tier - right.tier));
        return rule.selection === "first" ? sorted.slice(0, 1)
            : rule.selection === "last" ? sorted.slice(-1) : sorted;
    }
    register(def: EditorDefinition): void {
        this.definitions.set(def.id, def);
    }

    getById(id: string): EditorDefinition | undefined {
        return this.definitions.get(id);
    }

    resolveDefinition(id: string): EditorDefinition | undefined {
        return this.getById(id)
            ?? (parseBoardEditorId(id) !== null ? this.getById(EditorId.boardView) : undefined);
    }

    getAll(): EditorDefinition[] {
        return Array.from(this.definitions.values());
    }

    registerRestoreOnly(id: string, loadModule: () => Promise<EditorRestoreModule>): void {
        this.restoreOnlyLoaders.set(id, loadModule);
    }

    async getModuleForRestore(id: string): Promise<EditorRestoreModule | undefined> {
        if (this.definitions.has(id)) return this.loadModule(id);
        let module = this.restoreOnlyModules.get(id);
        if (module) return module;
        const loader = this.restoreOnlyLoaders.get(id);
        if (!loader) return undefined;
        module = await loader();
        this.restoreOnlyModules.set(id, module);
        return module;
    }

    async restoreFromDescriptor(
        descriptor: EditorDescriptor,
        context: EditorRestoreContext,
    ): Promise<EditorModel | null> {
        const module = await this.getModuleForRestore(descriptor.editorId);
        if (!module) {
            if (descriptor.host) return null;
            console.warn(`Unrecognized editor descriptor: ${descriptor.editorId}`);
            return null;
        }
        if (module.restoreFromDescriptor) {
            return module.restoreFromDescriptor(descriptor, context);
        }

        const definition = this.definitions.get(descriptor.editorId);
        if (descriptor.host) {
            if (!definition) return null;
            const editor = await this.createEditor(descriptor.editorId, descriptor.id);
            try {
                editor.applyRestoreData(descriptor as unknown as Parameters<typeof editor.applyRestoreData>[0]);
                await editor.restore();
                return editor;
            } catch (error) {
                await editor.dispose();
                throw error;
            }
        }
        if (definition && !definition.hasContentHost) {
            const editor = await this.createEditor(descriptor.editorId, descriptor.id);
            try {
                editor.state.update((state) => {
                    Object.assign(state as object, descriptor.state);
                    (state as { id: string }).id =
                        descriptor.id || (state as { id?: string }).id || crypto.randomUUID();
                });
                editor.applyRestoreData(
                    descriptor.state as unknown as Parameters<typeof editor.applyRestoreData>[0],
                );
                await editor.restore();
                return editor;
            } catch (error) {
                await editor.dispose();
                throw error;
            }
        }
        console.warn(`Unrecognized editor descriptor: ${descriptor.editorId}`);
        return null;
    }

    /** The language IDs accepted by Monaco and the built-in language-aware editors. */
    getLanguages(): readonly string[] {
        return monacoLanguages.map((language) => language.id);
    }

    /** Validate a public language argument without changing editor-resolution fallback behavior. */
    assertKnownLanguage(language: string | undefined): void {
        if (language !== undefined && !monacoLanguages.some((item) => item.id === language)) {
            throw new Error(
                'Unknown language "' + language + '". Read ' +
                `editors.languages for the valid ids.`,
            );
        }
    }

    resolveForFolder(folderPath: string): string {
        return this.rank({ purpose: "open-folder", folderPath })[0]?.id ?? EditorId.categoryView;
    }

    getFolderEditors(folderPath: string): string[] {
        return this.rank({ purpose: "folder-switch", folderPath }).map(({ id }) => id);
    }

    findEditorsAccepting(host: TextFileModel): string[] {
        const language = host.state.get().language;
        const fileName = (host as unknown as { filePath?: string }).filePath
            ?? (host.state.get() as { title?: string }).title;
        return this.rank({ purpose: "host-switch", host, language, fileName }).map(({ id }) => id);
    }

    resolve(fileName?: string): EditorDefinition | undefined {
        const id = this.rank({ purpose: "open-file", fileName })[0]?.id;
        return id ? this.definitions.get(id) : undefined;
    }

    resolveId(fileName?: string): string | undefined {
        return this.resolve(fileName)?.id;
    }

    getSwitchOptions(
        language: string,
        fileName?: string,
    ): { options: string[]; getOptionLabel: (option: string) => string } {
        const options = this.rank({ purpose: "language-switch", language, fileName }).map(({ id }) => id);
        const getOptionLabel = (option: string) => {
            if (!option || option === EditorId.monaco) return language.toUpperCase();
            return this.definitions.get(option)?.name ?? language.toUpperCase();
        };
        return { options: options.length > 1 ? options : [], getOptionLabel };
    }

    getPreviewEditor(language: string, fileName: string): string | undefined {
        return this.rank({ purpose: "preview", language, fileName }).at(-1)?.id;
    }

    validateForLanguage(editor: string | undefined, language: string): string | undefined {
        return editor && editor !== EditorId.monaco
            && this.rank({ purpose: "language-validation", editorId: editor, language })[0]?.valid === false
            ? EditorId.monaco
            : editor;
    }
    /** Lazy-load and create a bare editor by id; callers provide a host if needed, apply restore or switch data,
     *  then call `restore()`. `instanceId` preserves cache-file identity across restarts and windows; omit it
     *  for new pages, the switch widget, and file opens. */
    async createEditor(id: string, instanceId?: string): Promise<EditorModel> {
        await this.loadModule(id);
        return this.createEditorSync(id, instanceId);
    }

    /** Synchronous construction from the module cache for APIs such as `addEditorPage`, `openLinks`, and
     *  `page.grouped`. Content-host modules preload at startup; a miss throws a descriptive error. */
    createEditorSync(id: string, instanceId?: string): EditorModel {
        const def = this.definitions.get(id);
        if (!def) throw new Error(`No editor registered for id: ${id}`);
        const module = this.modules.get(id);
        if (!module) {
            throw new Error(
                `Editor module "${id}" is not loaded yet (startup preload still running). Retry in a moment.`,
            );
        }
        const editor = module.createEditor();
        // Modules start with an empty id; only a real instance id may be stamped because panel keys use it.
        if (instanceId) {
            editor.state.update((s) => { s.id = instanceId; });
        }
        return editor;
    }

    /** Preload content-host modules for synchronous construction; failures are logged and surface on first use. */
    preloadContentHostModules(): void {
        for (const def of this.definitions.values()) {
            if (!def.hasContentHost) continue;
            void this.loadModule(def.id).catch((err: unknown): undefined => {
                console.warn(`[editorRegistry] preload of "${def.id}" failed:`, err);
                return undefined;
            });
        }
    }

    /** Public module accessor - loads and caches the module for an id. */
    getModule(id: string): Promise<EditorModule<EditorModel>> {
        return this.loadModule(id);
    }

    private async loadModule(id: string): Promise<EditorModule<EditorModel>> {
        let module = this.modules.get(id);
        if (module) return module;
        const def = this.definitions.get(id);
        if (!def) throw new Error(`No editor registered for id: ${id}`);
        module = await def.loadModule();
        this.modules.set(id, module);
        return module;
    }
}

export const editorRegistry = new EditorRegistry();

/** Explicit content-host targets override preview/default selection; ordinary opens match `resolveId(filePath)`.
 *  Shared by open-file and navigate flows. */
export function isExplicitHostTarget(
    target: string | undefined,
    filePath: string,
): boolean {
    return (
        !!target &&
        target !== editorRegistry.resolveId(filePath) &&
        !!editorRegistry.getById(target)?.hasContentHost
    );
}
