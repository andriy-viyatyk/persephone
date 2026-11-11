import type { EditorModel } from "../../editors/base/EditorModel";
import type { IContentPipe } from "../types/io.pipe";
import { isBoardEditorId } from "./custom-editor-registry";

export interface IBoardHostEditor {
    readonly boardRoot: string | undefined;
    readonly frameRegistry: {
        isCurrentFrame(tab: string, frame: HTMLIFrameElement): boolean;
    };
    recordBoardThemePreview(boardId: string, generation: number): void;
    readonly pipeUrlEnabled?: boolean;
    resolveStreamPipe?(): Promise<IContentPipe>;
}

export function asBoardHostEditor(editor: EditorModel | null | undefined): IBoardHostEditor | undefined {
    return editor && isBoardEditorId(editor.editorId) ? editor as unknown as IBoardHostEditor : undefined;
}
