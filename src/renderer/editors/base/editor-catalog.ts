import { EditorId } from "../../../shared/editor-ids";
import type { EditorModelInstance as EditorModel } from "./EditorModel";
import { editorRegistry } from "./editorRegistry";
import { fpBasename, fpExtname } from "../../core/utils/file-path";
import { getLanguageByExtension } from "../../core/utils/language-mapping";
import type { MessageKey } from "../../../shared/i18n/en";

export type EditorTransition = "host-transfer" | "rebuild" | "install";

/** One ordered option shared by the toolbar, scripting projection, and open-with menu. */
export interface EditorCandidate {
    readonly id: string;
    readonly label: string;
    readonly labelKey?: MessageKey;
    readonly title?: string;
    readonly titleKey?: MessageKey;
    readonly labelParams?: Record<string, string | number>;
    readonly displayLabel?: string;
    readonly transition: EditorTransition;
    readonly boardRoot?: string;
}

export interface EditorResolution {
    readonly id: string;
    readonly priority: number;
}

export interface EditorDescription {
    readonly label: string;
    readonly displayLabel?: string;
    readonly boardRoot?: string;
}

export interface EditorSource {
    resolveFile(filePath: string, matchPath?: string): EditorResolution | undefined;
    resolveFolder(folderPath: string): EditorResolution | undefined;
    candidatesForFile(filePath: string): readonly EditorCandidate[];
    candidatesForFolder(folderPath: string): readonly EditorCandidate[];
    switchCandidates(model: EditorModel): readonly EditorCandidate[];
    candidateById(id: string, model: EditorModel): EditorCandidate | undefined;
    describe(id: string): EditorDescription | undefined;
    subscribe(listener: () => void): () => void;
}

/** Built-in editor adapter. Matcher behavior stays in EditorRegistry. */
export class BuiltInEditorSource implements EditorSource {
    resolveFile(filePath: string, matchPath = filePath): EditorResolution | undefined {
        const definition = editorRegistry.resolve(matchPath);
        if (!definition) return undefined;
        const ranked = editorRegistry.rank({ purpose: "open-file", editorId: definition.id, fileName: matchPath })[0];
        return { id: definition.id, priority: ranked?.tier ?? 0 };
    }

    resolveFolder(folderPath: string): EditorResolution | undefined {
        const id = editorRegistry.resolveForFolder(folderPath);
        const ranked = editorRegistry.rank({ purpose: "open-folder", editorId: id, folderPath })[0];
        return { id, priority: ranked?.tier ?? 0 };
    }

    candidatesForFile(filePath: string): readonly EditorCandidate[] {
        const fileName = fpBasename(filePath);
        const language = getLanguageByExtension(fpExtname(fileName))?.id ?? "plaintext";
        const options = editorRegistry.getSwitchOptions(language, fileName);
        const ids = [...options.options];
        for (const definition of editorRegistry.getAll()) {
            const fileMatch = editorRegistry.rank({ purpose: "open-file", editorId: definition.id, fileName })[0];
            if (fileMatch && !ids.includes(definition.id)) ids.push(definition.id);
        }
        return ids.flatMap((id) => {
            const definition = editorRegistry.getById(id);
            return definition ? [{ id, label: options.options.includes(id) ? options.getOptionLabel(id) : definition.name,
                labelKey: id === EditorId.monaco ? undefined : definition.nameKey,
                transition: definition.hasContentHost ? "host-transfer" : "rebuild" as EditorTransition }] : [];
        });
    }

    candidatesForFolder(folderPath: string): readonly EditorCandidate[] {
        return editorRegistry.getFolderEditors(folderPath).flatMap((id) => {
            const definition = editorRegistry.getById(id);
            return definition ? [{ id, label: definition.name, labelKey: definition.nameKey,
                transition: definition.hasContentHost ? "host-transfer" : "rebuild" as EditorTransition }] : [];
        });
    }

    switchCandidates(model: EditorModel): readonly EditorCandidate[] {
        if (model.folderAnchor !== undefined) return this.candidatesForFolder(model.folderAnchor);
        return model.findCompatibleEditors().flatMap((id) => {
            const definition = editorRegistry.getById(id);
            return definition && id !== EditorId.boardInfo ? [{ id, label: definition.name,
                labelKey: definition.nameKey,
                transition: definition.hasContentHost ? "host-transfer" : "rebuild" as EditorTransition }] : [];
        });
    }

    candidateById(id: string, _model: EditorModel): EditorCandidate | undefined {
        if (id === EditorId.boardInfo) return undefined;
        const definition = editorRegistry.getById(id);
        return definition ? {
            id,
            label: definition.name,
            labelKey: definition.nameKey,
            transition: definition.hasContentHost ? "host-transfer" : "rebuild",
        } : undefined;
    }

    describe(id: string): EditorDescription | undefined {
        const definition = editorRegistry.getById(id);
        return definition ? { label: definition.name } : undefined;
    }

    subscribe(_listener: () => void): () => void { return () => undefined; }
}

/**
 * One ordered composition point for built-in and registered editor sources.
 * Resolution uses strict priority comparisons (so the built-in source wins ties);
 * candidate lists retain built-in then source-registration order and are never priority-sorted.
 */
export class EditorCatalog {
    private readonly sources: EditorSource[] = [new BuiltInEditorSource()];
    private listeners = new Set<() => void>();
    private sourceCleanups = new Map<EditorSource, () => void>();

    registerSource(source: EditorSource): void {
        if (this.sources.includes(source)) return;
        this.sources.push(source);
        this.sourceCleanups.set(source, source.subscribe(() => this.notify()));
        this.notify();
    }

    resolveFile(filePath: string, matchPath?: string): string | undefined {
        return this.resolve((source) => source.resolveFile(filePath, matchPath));
    }

    resolveFolder(folderPath: string): string | undefined {
        return this.resolve((source) => source.resolveFolder(folderPath));
    }

    candidatesForFile(filePath: string): EditorCandidate[] {
        return this.unique(this.sources.flatMap((source) => [...source.candidatesForFile(filePath)]));
    }

    candidatesForFolder(folderPath: string): EditorCandidate[] {
        return this.unique(this.sources.flatMap((source) => [...source.candidatesForFolder(folderPath)]));
    }

    switchCandidates(model: EditorModel): EditorCandidate[] {
        const builtIns = [...(this.sources[0]?.switchCandidates(model) ?? [])];
        const extensions = this.sources.slice(1).flatMap((source) => [...source.switchCandidates(model)]);
        // Add an omitted current editor after built-in peers and before board choices.
        if (![...builtIns, ...extensions].some(({ id }) => id === model.editorId)) {
            const description = this.describe(model.editorId);
            builtIns.push({ id: model.editorId, label: description?.label ?? model.editorId,
                displayLabel: description?.displayLabel, boardRoot: description?.boardRoot,
                transition: this.transitionFor(model.editorId) });
        }
        const candidates = this.unique([...builtIns, ...extensions]);
        const installIndex = candidates.findIndex(({ transition }) => transition === "install");
        if (installIndex !== -1 && installIndex !== candidates.length - 1) {
            candidates.push(...candidates.splice(installIndex, 1));
        }
        return candidates;
    }

    switchOptions(model: EditorModel): EditorCandidate[] { return this.switchCandidates(model); }

    getSwitchCandidate(model: EditorModel, id: string): EditorCandidate {
        for (const source of this.sources) {
            const candidate = source.candidateById(id, model);
            if (candidate) return candidate;
        }
        throw new Error(`No editor registered for id: ${id}`);
    }

    describe(id: string): EditorDescription | undefined {
        for (const source of this.sources) {
            const description = source.describe(id);
            if (description) return description;
        }
        return undefined;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private resolve(get: (source: EditorSource) => EditorResolution | undefined): string | undefined {
        let winner: EditorResolution | undefined;
        for (const source of this.sources) {
            const candidate = get(source);
            if (candidate && (!winner || candidate.priority > winner.priority)) winner = candidate;
        }
        return winner?.id;
    }

    private unique(candidates: EditorCandidate[]): EditorCandidate[] {
        const result: EditorCandidate[] = [];
        const seen = new Set<string>();
        for (const candidate of candidates) {
            if (seen.has(candidate.id)) continue;
            seen.add(candidate.id);
            result.push(candidate);
        }
        return result;
    }

    private transitionFor(id: string): EditorTransition {
        return editorRegistry.getById(id)?.hasContentHost ? "host-transfer" : "rebuild";
    }

    private notify(): void { for (const listener of this.listeners) listener(); }
}

export const editorCatalog = new EditorCatalog();
