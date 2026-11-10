import { TComponentState } from "../../core/state/state";
import { decodePersephoneBoardLink } from "../../content/persephone-board-link";
import { customEditorRegistry } from "../../api/boards/custom-editor-registry";
import { boardRegistry } from "../../api/boards/board-registry";
import { fpBasename } from "../../core/utils/file-path";
import {
    BoardEditorModel,
    getDefaultBoardEditorState,
} from "./BoardEditorModel";
import { BoardStreamEditorModel } from "./BoardStreamEditorModel";
import { BoardEditorView } from "./BoardEditorView";
import type { EditorModule } from "../base/editorRegistry";
import type { EditorModel } from "../base/EditorModel";
import type { EditorDescriptor } from "../../../shared/persistence";
import type { BoardEditorKind } from "../../../shared/board/board-manifest-schema";

export type BoardEditorSpec =
    | { kind: "plain"; boardRoot: string }
    | { kind: "file"; boardRoot: string; filePath?: string; host?: "new"; editorKind?: BoardEditorKind }
    | { kind: "folder"; boardRoot: string; folderPath: string }
    | { kind: "restore"; descriptor: EditorDescriptor };

export function createBoardEditor(
    spec: Exclude<BoardEditorSpec, { kind: "restore" }>,
): Promise<BoardEditorModel>;
export function createBoardEditor(
    spec: Extract<BoardEditorSpec, { kind: "restore" }>,
): Promise<BoardEditorModel | null>;
export async function createBoardEditor(
    spec: BoardEditorSpec,
): Promise<BoardEditorModel | null> {
    await customEditorRegistry.ensureInitialized();
    if (spec.kind === "restore") {
        const descriptor = spec.descriptor;
        if (descriptor.editorId === "draw-view") {
            await boardRegistry.load();
            const excalidraw = boardRegistry.bundled().find((board) => board.id === "excalidraw");
            if (!excalidraw || excalidraw.manifest.association?.editorKind !== "content-host") return null;
            const { BoardContentEditorModel } = await import("./BoardContentEditorModel");
            const model = new BoardContentEditorModel(new TComponentState({
                ...getDefaultBoardEditorState(),
                ...descriptor.state,
                id: descriptor.id,
                boardRoot: excalidraw.root,
            }));
            model.applyRestoreData(
                descriptor as unknown as Parameters<typeof model.applyRestoreData>[0],
            );
            // restore() does not re-derive the selection from boardRoot; refreshBoards() only clears it, and
            // BoardEditorView shows its not-found state while the selection is unset. Seed the old tab and icon.
            model.selectBoard(fpBasename(excalidraw.root));
            return model;
        }
        if (descriptor.host) {
            const { BoardContentEditorModel } = await import("./BoardContentEditorModel");
            const model = new BoardContentEditorModel(new TComponentState({
                ...getDefaultBoardEditorState(),
                ...descriptor.state,
                id: descriptor.id,
            }));
            model.applyRestoreData(
                descriptor as unknown as Parameters<typeof model.applyRestoreData>[0],
            );
            return model;
        }

        const boardState = descriptor.state as Partial<ReturnType<typeof getDefaultBoardEditorState>>;
        const editorKind = customEditorRegistry.findByRoot(boardState.boardRoot)?.editorKind;
        const model = editorKind === "stream-host"
            ? new BoardStreamEditorModel(new TComponentState({
                ...getDefaultBoardEditorState(),
                ...descriptor.state,
                id: descriptor.id || boardState.id || crypto.randomUUID(),
            }))
            : createPlainBoardEditorWithState({
                ...getDefaultBoardEditorState(),
                ...descriptor.state,
                id: descriptor.id || boardState.id || crypto.randomUUID(),
            });
        model.applyRestoreData(
            descriptor.state as unknown as Parameters<typeof model.applyRestoreData>[0],
        );
        return model;
    }

    const root = customEditorRegistry.canonicalRoot(spec.boardRoot);
    if (spec.kind === "folder") {
        if (!customEditorRegistry.findFolderClaim(root, spec.folderPath)) {
            throw new Error("Board does not claim folder: " + spec.folderPath);
        }
        const model = createPlainBoardEditor();
        model.initFromBoardRoot(root, undefined, spec.folderPath);
        return model;
    }

    if (spec.kind === "plain") {
        const model = createPlainBoardEditor();
        model.initFromBoardRoot(root);
        return model;
    }

    const editorKind = spec.editorKind ?? customEditorRegistry.findByRoot(root)?.editorKind ?? "simple";
    let model: BoardEditorModel;
    if (editorKind === "content-host") {
        const { BoardContentEditorModel } = await import("./BoardContentEditorModel");
        const contentModel = new BoardContentEditorModel(new TComponentState(getDefaultBoardEditorState()));
        if (spec.host === "new") {
            const { newTextFileModel } = await import("../text");
            contentModel.adoptHost(newTextFileModel(spec.filePath));
        }
        model = contentModel;
    } else if (editorKind === "stream-host") {
        model = new BoardStreamEditorModel(new TComponentState(getDefaultBoardEditorState()));
    } else {
        model = createPlainBoardEditor();
    }
    model.initFromBoardRoot(root, spec.filePath);
    return model;
}

function createPlainBoardEditor(): BoardEditorModel {
    return new BoardEditorModel(new TComponentState(getDefaultBoardEditorState()));
}

function createPlainBoardEditorWithState(
    state: ReturnType<typeof getDefaultBoardEditorState>,
): BoardEditorModel {
    return new BoardEditorModel(new TComponentState(state));
}

export const boardModule: EditorModule = {
    createEditor: createPlainBoardEditor,
    View: BoardEditorView,
    newEditorModel: async (filePath?: string) => {
        const link = filePath ? decodePersephoneBoardLink(filePath) : undefined;
        const model = link
            ? await createBoardEditor({ kind: "plain", boardRoot: link.boardRoot })
            : createPlainBoardEditor();
        return model as unknown as EditorModel;
    },
};

export { BoardEditorModel } from "./BoardEditorModel";
export type { BoardEditorState } from "./BoardEditorModel";
