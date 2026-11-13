import { EditorModel } from "./base/EditorModel";
import { TextFileModel, newTextFileModel } from "./content-host/TextFileModel";
import { MonacoEditor, defaultMonacoEditorState } from "./monaco/MonacoEditor";
import { TextHostEditorModel } from "./base/TextHostEditorModel";
import { TComponentState } from "../core/state/state";
import { editorRegistry, isExplicitHostTarget } from "./base/editorRegistry";
import {
    resolveEditorIdForFile,
    resolveBoardEditorId,
} from "../api/boards/custom-editor-registry";
import { parseBoardEditorId } from "../../shared/board/board-editor-id";
import { fpBasename, fpExtname } from "../core/utils/file-path";
import { getLanguageByExtension } from "../core/utils/language-mapping";
import type { IContentPipe } from "../api/types/io.pipe";

interface EditorSelectionOptions {
    forceText?: boolean;
    selectPreview?: boolean;
}

/** Build an editor around a host through the registry's synchronous cache. */
export function createEditorFromContentHost(host: TextFileModel): EditorModel {
    const state = host.state.get();
    const targetEditorId = state.editor || "monaco";
    const id = state.id || crypto.randomUUID();
    if (targetEditorId === "monaco") {
        const monaco = new MonacoEditor(
            new TComponentState({ ...defaultMonacoEditorState, id }),
        );
        monaco.adoptHost(host);
        return monaco;
    }

    const editor = editorRegistry.createEditorSync(targetEditorId, id);
    if (!(editor instanceof TextHostEditorModel)) {
        throw new Error(`Editor "${targetEditorId}" does not wrap a text host.`);
    }
    editor.adoptHost(host);
    editor.bootstrapFromHost();
    return editor;
}

/** Resolve the class that should wrap a content host before constructing it. */
function resolveContentEditorId(
    filePath: string | undefined,
    target: string | undefined,
    options: EditorSelectionOptions,
): string {
    // The host default, as `newTextFileModel` sets it: built-in matches only, never a board id.
    const naturalId = editorRegistry.resolveId(filePath) ?? "monaco";
    if (options.forceText) return "monaco";
    if (target && isExplicitHostTarget(target, filePath ?? "")) return target;
    if (options.selectPreview && filePath) {
        const languageId = getLanguageByExtension(fpExtname(filePath).toLowerCase())?.id ?? "plaintext";
        return editorRegistry.getPreviewEditor(languageId, filePath) ?? naturalId;
    }
    return naturalId;
}

/** Construct an editor by the natural file match, falling back to Monaco. */
async function newEditorModel(
    filePath?: string,
    options: EditorSelectionOptions = {},
): Promise<EditorModel> {
    return buildEditorById(resolveEditorIdForFile(filePath) ?? "monaco", filePath, undefined, options);
}

/** Construct an editor for an explicit target. */
async function newEditorModelByTarget(
    filePath: string,
    target: string,
    options: EditorSelectionOptions = {},
): Promise<EditorModel> {
    return buildEditorById(target, filePath, undefined, options);
}

/** Construct an editor for an editor id + optional file path. */
export async function buildEditorById(
    editorId: string,
    filePath?: string,
    folderPath?: string,
    options: EditorSelectionOptions = {},
): Promise<EditorModel> {
    editorId = await resolveBoardEditorId(editorId);
    const boardRoot = parseBoardEditorId(editorId);
    if (boardRoot !== null) {
        const { createBoardEditor } = await import("./board");
        return createBoardEditor(folderPath !== undefined
            ? { kind: "folder", boardRoot, folderPath }
            : { kind: "file", boardRoot, filePath, host: "new" });
    }

    const definition = editorRegistry.getById(editorId);
    if (!definition || definition.hasContentHost) {
        const host = newTextFileModel(filePath);
        host.state.update((state) => {
            state.editor = resolveContentEditorId(filePath, editorId, options) as typeof state.editor;
        });
        return createEditorFromContentHost(host);
    }

    const module = await editorRegistry.getModule(editorId);
    if (module.newEditorModel) return module.newEditorModel(filePath);

    const host = newTextFileModel(filePath);
    host.state.update((state) => {
        state.editor = resolveContentEditorId(filePath, editorId, options) as typeof state.editor;
    });
    return createEditorFromContentHost(host);
}

/** Construct without restoring, for callers that must defer restore. */
export async function constructEditorFromFile(
    filePath: string,
    pipe?: IContentPipe,
    target?: string,
    title?: string,
    options: EditorSelectionOptions = {},
): Promise<EditorModel> {
    const editor = target
        ? await newEditorModelByTarget(filePath, target, options)
        : await newEditorModel(filePath, options);
    const host = editor.contentHost;
    if (pipe) {
        if (host) host.setPipe(pipe);
        else editor.pipe = pipe;
    }
    (host ?? editor).state.update((state) => { state.language = ""; });
    const shouldSeedDefaultTitle = editor.deferRestoreOnOpen;
    const seededTitle = title || (shouldSeedDefaultTitle ? fpBasename(filePath) : undefined);
    if (seededTitle) {
        editor.state.update((state) => { state.title = seededTitle; });
        if (host) host.state.update((state) => { state.title = seededTitle; });
    }
    return editor;
}

export async function createEditorFromFile(
    filePath: string,
    pipe?: IContentPipe,
    target?: string,
    title?: string,
    options: EditorSelectionOptions = {},
): Promise<EditorModel> {
    const editor = await constructEditorFromFile(filePath, pipe, target, title, options);
    await editor.restore();
    return editor;
}

/** Construct and restore a trusted board for a claimed folder. */
export async function createEditorFromFolder(
    editorId: string,
    folderPath: string,
): Promise<EditorModel> {
    if (parseBoardEditorId(editorId) === null) {
        throw new Error(`Invalid folder board editor id: ${editorId}`);
    }
    const editor = await buildEditorById(editorId, undefined, folderPath);
    await editor.restore();
    return editor;
}
