import { PageEditor } from "../../shared/types";
import { EditorDefinition, EditorModule, ViewModelFactory } from "./types";
import type { IContentHost } from "./base/IContentHost";

/**
 * Options for the editor switch UI component.
 */
export interface SwitchOptions {
    options: PageEditor[];
    getOptionLabel: (option: PageEditor) => string;
}

/**
 * Central registry for all editors in the application.
 * Provides methods for registering, resolving, and querying editors.
 */
class EditorRegistry {
    private editors = new Map<PageEditor, EditorDefinition>();
    private modules = new Map<PageEditor, EditorModule>();

    /**
     * Register an editor definition.
     */
    register(definition: EditorDefinition): void {
        if (this.editors.has(definition.id)) {
            console.warn(`Editor "${definition.id}" is already registered. Overwriting.`);
        }
        this.editors.set(definition.id, definition);
    }

    /**
     * Get an editor definition by ID.
     */
    getById(id: PageEditor): EditorDefinition | undefined {
        return this.editors.get(id);
    }

    /**
     * Get all registered editor definitions.
     */
    getAll(): EditorDefinition[] {
        return Array.from(this.editors.values());
    }

    /**
     * Resolve the best matching editor for a file path.
     * Queries each editor's acceptFile() and returns the one with highest priority.
     */
    resolve(filePath?: string): EditorDefinition | undefined {
        if (!filePath) {
            return undefined;
        }

        let bestMatch: EditorDefinition | undefined;
        let bestPriority = -1;

        for (const editor of this.editors.values()) {
            const priority = editor.acceptFile?.(filePath) ?? -1;
            if (priority > bestPriority) {
                bestMatch = editor;
                bestPriority = priority;
            }
        }

        return bestMatch;
    }

    /**
     * Resolve the editor ID for a file path.
     * Convenience method that returns just the ID instead of the full definition.
     */
    resolveId(filePath?: string): PageEditor | undefined {
        return this.resolve(filePath)?.id;
    }

    /**
     * Validate that an editor is compatible with a language.
     * Returns "monaco" if the editor doesn't support the language.
     */
    validateForLanguage(editor: PageEditor | undefined, languageId: string): PageEditor {
        if (!editor || editor === "monaco") {
            return editor;
        }

        const editorDef = this.getById(editor);
        if (editorDef?.validForLanguage?.(languageId) === false) {
            return "monaco";
        }

        return editor;
    }

    /**
     * Get the preferred preview editor for a file in navigation context.
     * Like getSwitchOptions but skips editors whose acceptFile() returns -1
     * (e.g., grid-json for non-.grid.json files).
     * Returns undefined if no preview editor should be auto-selected.
     */
    getPreviewEditor(languageId: string, filePath: string): PageEditor | undefined {
        const results: { id: PageEditor; priority: number }[] = [];

        for (const editor of this.editors.values()) {
            if (editor.id === "monaco") continue;
            const priority = editor.switchOption?.(languageId, filePath) ?? -1;
            if (priority < 0) continue;
            // Skip if acceptFile explicitly rejects this file
            if (editor.acceptFile && editor.acceptFile(filePath) < 0) continue;
            results.push({ id: editor.id, priority });
        }

        if (results.length === 0) return undefined;
        results.sort((a, b) => a.priority - b.priority);
        return results[results.length - 1].id;
    }

    /**
     * Get available editor switch options for a language (used in UI).
     * Queries each editor's switchOption() and returns sorted list.
     * Returns an empty options array if only one editor is available.
     */
    getSwitchOptions(languageId: string, filePath?: string): SwitchOptions {
        const results: { id: PageEditor; priority: number }[] = [];

        for (const editor of this.editors.values()) {
            const priority = editor.switchOption?.(languageId, filePath) ?? -1;
            if (priority >= 0) {
                results.push({ id: editor.id, priority });
            }
        }

        // Sort by priority (lower first, so monaco at 0 comes first)
        results.sort((a, b) => a.priority - b.priority);

        const options = results.map((r) => r.id);

        const getOptionLabel = (option: PageEditor) => {
            if (!option || option === "monaco") {
                return languageId.toUpperCase();
            }
            const editorDef = this.getById(option);
            return editorDef?.name ?? languageId.toUpperCase();
        };

        return {
            options: options.length > 1 ? options : [],
            getOptionLabel,
        };
    }

    /**
     * Detect if file content matches a structured editor via the `isEditorContent` hook.
     * Returns the first matching editor ID, or undefined if no match.
     * Uses fast regex checks — no JSON parsing.
     */
    detectContentEditor(languageId: string, content: string): PageEditor | undefined {
        if (!content) return undefined;
        for (const editor of this.editors.values()) {
            if (editor.isEditorContent?.(languageId, content)) {
                return editor.id;
            }
        }
        return undefined;
    }

    // =========================================================================
    // Content View Model support
    // =========================================================================

    /**
     * Cache a loaded editor module.
     * Called by loadViewModelFactory and can be called by AsyncEditor.
     */
    cacheModule(editorId: PageEditor, module: EditorModule): void {
        this.modules.set(editorId, module);
    }

    /**
     * Get the cached module for an editor (if already loaded).
     */
    getCachedModule(editorId: PageEditor): EditorModule | undefined {
        return this.modules.get(editorId);
    }

    /**
     * Get the view model factory for an editor (sync).
     * Returns undefined if the module hasn't been loaded yet.
     */
    getViewModelFactory(editorId: PageEditor): ViewModelFactory | undefined {
        return this.modules.get(editorId)?.createViewModel;
    }

    /**
     * Load the editor module and return its view model factory (async).
     * Caches the module for future sync access.
     * Throws if the editor has no definition or no createViewModel factory.
     */
    async loadViewModelFactory(editorId: PageEditor): Promise<ViewModelFactory> {
        // Check cache first
        const cached = this.modules.get(editorId);
        if (cached) {
            if (!cached.createViewModel) {
                throw new Error(`Editor "${editorId}" does not provide a view model factory.`);
            }
            return cached.createViewModel;
        }

        const def = this.editors.get(editorId);
        if (!def) {
            throw new Error(`Editor "${editorId}" is not registered.`);
        }

        const module = await def.loadModule();
        this.modules.set(editorId, module);

        if (!module.createViewModel) {
            throw new Error(`Editor "${editorId}" does not provide a view model factory.`);
        }
        return module.createViewModel;
    }

    /**
     * Validate that an editor is applicable for a content host.
     * Throws a descriptive error if the editor cannot be used with the host's language.
     */
    validateForHost(editorId: PageEditor, host: IContentHost): void {
        if (editorId === "monaco") return;

        const def = this.editors.get(editorId);
        if (!def) {
            throw new Error(`Editor "${editorId}" is not registered.`);
        }

        const language = host.state.get().language || "";
        if (def.validForLanguage && !def.validForLanguage(language)) {
            throw new Error(
                `Editor "${editorId}" is not applicable for "${language}" content.`
            );
        }
    }
}

export const editorRegistry = new EditorRegistry();
