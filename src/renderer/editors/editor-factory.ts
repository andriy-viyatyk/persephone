import { EditorModel } from "./base/EditorModel";
import type { EditorOrHost } from "./base";
import { TextFileModel, newTextFileModel } from "./text";
import { MonacoEditor, defaultMonacoEditorState } from "./monaco/MonacoEditor";
import { TextHostEditorModel } from "./base/TextHostEditorModel";
import { TComponentState } from "../core/state/state";
import { editorRegistry } from "./base/editorRegistry";
import {
    resolveEditorIdForFile,
    parseBoardEditorId,
    resolveBoardEditorId,
} from "../api/boards/custom-editor-registry";
import { fpBasename } from "../core/utils/file-path";
import type { IContentPipe } from "../api/types/io.pipe";

/** Attach an `EditorModel` or `TextFileModel` host to a page.
 *  - `EditorModel` input: returned unchanged.
 *  - `TextFileModel` host input: construct a fresh editor over the host
 *    driven by `state.editor` (e.g. "monaco", "grid-json", "md-view", …) and
 *    return it. */
export function attachEditorToPage(legacy: EditorOrHost): EditorModel {
    if (legacy instanceof EditorModel) {
        return legacy as unknown as EditorModel;
    }

    const legacyState = legacy.state.get() as { type?: string; editor?: string };
    if (legacyState.type !== "textFile") {
        throw new Error(
            `attachEditorToPage: no mapping for editor id "${legacyState.editor ?? "monaco"}" (type "${legacyState.type ?? "?"}").`,
        );
    }
    const host = legacy as TextFileModel;
    const targetEditorId = legacyState.editor || "monaco";
    const id = host.state.get().id || crypto.randomUUID();

    // Monaco is the guaranteed-synchronous floor: the startup empty page and
    // `requireGroupedText` build it before the registry's content-host module
    // preload can be assumed complete, so it stays a static construction.
    if (targetEditorId === "monaco") {
        const monaco = new MonacoEditor(
            new TComponentState({ ...defaultMonacoEditorState, id }),
        );
        monaco.adoptHost(host);
        return monaco;
    }

    // Every other text-host editor comes from the registry's module cache
    // (warmed at startup by `preloadContentHostModules` — construction here
    // must stay synchronous, see `createEditorSync`).
    const editor = editorRegistry.createEditorSync(targetEditorId, id);
    if (!(editor instanceof TextHostEditorModel)) {
        throw new Error(
            `attachEditorToPage: editor "${targetEditorId}" does not wrap a text host.`,
        );
    }
    editor.adoptHost(host);
    // adoptHost only wires subscriptions — open-file callers have already
    // invoked host.restore(), so trigger the same initial parse/load the
    // switch and session-restore paths get via onHostAttached (no-op for
    // editors that parse inside adoptHost, e.g. env-vars).
    editor.bootstrapFromHost();
    return editor;
}

/** Construct an editor by the natural file match, falling back to Monaco. */
async function newEditorModel(filePath?: string): Promise<EditorOrHost> {
    // Merged resolution (built-in registry + trusted file-associated boards).
    const targetId = resolveEditorIdForFile(filePath) ?? "monaco";
    return buildEditorById(targetId, filePath);
}

/** Construct an editor for an explicit target. */
async function newEditorModelByTarget(
    filePath: string,
    target: string,
): Promise<EditorOrHost> {
    return buildEditorById(target, filePath);
}

/** Construct an editor for an editor id + optional file path. Text-bearing
 *  editors get a fresh TextFileModel host; no-host editors go through their
 *  standalone shim. */
export async function buildEditorById(
    editorId: string,
    filePath?: string,
    folderPath?: string,
): Promise<EditorOrHost> {
    editorId = await resolveBoardEditorId(editorId);
    // Custom-editor board: a `board-editor:<root>` id has no static
    // registry def, so branch BEFORE the `!def` text fallback (which would else
    // open the file silently as text). Build the board initialized with the file
    // it edits (→ persephone.getFilePath()).
    const boardRoot = parseBoardEditorId(editorId);
    if (boardRoot !== null) {
        const { createBoardEditor } = await import("./board");
        return (await createBoardEditor(folderPath !== undefined
            ? { kind: "folder", boardRoot, folderPath }
            : { kind: "file", boardRoot, filePath, host: "new" })) as unknown as EditorOrHost;
    }
    const def = editorRegistry.getById(editorId);
    if (!def || def.hasContentHost) {
        // Text-bearing or unknown — build a TextFileModel host.
        // `attachEditorToPage` picks the editor class based on
        // state.editor (set by `getPreviewEditor` in navigatePageTo,
        // or by `resolveId` for fresh file opens).
        return newTextFileModel(filePath) as unknown as EditorOrHost;
    }
    // No-host editor: modules that open from a file path (image, archive,
    // video, category, git-tree, mneme-root, board, toolset) declare
    // `newEditorModel`; a no-host id without it (browser, settings, …) is
    // never a file-open target and falls back to a Monaco text host.
    const module = await editorRegistry.getModule(editorId);
    if (module.newEditorModel) {
        return (await module.newEditorModel(filePath)) as unknown as EditorOrHost;
    }
    return newTextFileModel(filePath) as unknown as EditorOrHost;
}

/** Construct without restoring, for callers that must defer restore. */
export async function constructEditorFromFile(
    filePath: string,
    pipe?: IContentPipe,
    target?: string,
    title?: string,
): Promise<EditorOrHost> {
    const editor = target
        ? await newEditorModelByTarget(filePath, target)
        : await newEditorModel(filePath);
    // A content-host board owns its content on the adopted HOST, not on the
    // board's own state — so pipe assignment and the pre-restore language reset must
    // target the host. A bare TextFileModel host has no `contentHost` accessor, so
    // `host` is null and everything falls through to the editor itself (unchanged for
    // every text editor and the simple board, whose never-read pipe is disposed on dispose).
    const host = (editor as EditorModel).contentHost;
    if (pipe) {
        if (host) {
            (host as unknown as TextFileModel).setPipe(pipe);
        } else {
            editor.pipe = pipe;
        }
    }
    // Reset language to "" on whichever object carries the content state so restore()
    // re-derives it from the file extension (its `s.language || getLanguageByExtension(ext)`
    // guard only falls through when language is falsy — the default "plaintext" is truthy).
    // For a content-host board the language lives on the host, not on the board's state.
    (host ?? editor).state.update((s) => {
        s.language = "";
    });
    const shouldSeedDefaultTitle = !(editor instanceof EditorModel) || editor.deferRestoreOnOpen;
    const seededTitle = title || (shouldSeedDefaultTitle ? fpBasename(filePath) : undefined);
    if (seededTitle) {
        editor.state.update((s) => { s.title = seededTitle; });
        if (host) host.state.update((s) => { (s as unknown as { title: string }).title = seededTitle; });
    }
    return editor;
}

export async function createEditorFromFile(
    filePath: string,
    pipe?: IContentPipe,
    target?: string,
    title?: string,
): Promise<EditorOrHost> {
    const editor = await constructEditorFromFile(filePath, pipe, target, title);
    await editor.restore();
    return editor;
}

/** Construct and restore a trusted board for a claimed folder. */
export async function createEditorFromFolder(
    editorId: string,
    folderPath: string,
): Promise<EditorOrHost> {
    if (parseBoardEditorId(editorId) === null) {
        throw new Error(`Invalid folder board editor id: ${editorId}`);
    }
    const editor = await buildEditorById(editorId, undefined, folderPath);
    await editor.restore();
    return editor;
}
