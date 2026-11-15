import type { BoardEditorModel } from "../BoardEditorModel";
import type { BoardMessageContext } from "./board-host-router";
import type { BoardFrameSession } from "./BoardFrameSession";
import { boardRegistry } from "../../../api/boards/board-registry";
import { getBoardWorkingFolder } from "../model/BoardWorkingFolder";

export class WorkingFolderBridge {
    private readonly workingFolder: ReturnType<typeof getBoardWorkingFolder>;

    constructor(
        model: BoardEditorModel,
        private readonly boardRoot: string,
        private readonly session: BoardFrameSession,
    ) {
        this.workingFolder = getBoardWorkingFolder(model);
    }

    set(params: { path?: string | null }, context: BoardMessageContext): Promise<void> {
        return this.workingFolder.set(params.path, context, this.session, () =>
            boardRegistry.isPermitted(this.boardRoot));
    }

    clearGeneration(generation: number): void {
        this.workingFolder.clearGeneration(generation);
    }
}
