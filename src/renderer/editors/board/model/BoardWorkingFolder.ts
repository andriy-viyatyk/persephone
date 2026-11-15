import type { BoardEditorModel } from "../BoardEditorModel";
import type { BoardMessageContext } from "../frame/board-host-router";
import type { BoardFrameSession } from "../frame/BoardFrameSession";
import { fs as appFs } from "../../../api/fs";
import { fpIsAbsolute, isArchivePath } from "../../../core/utils/file-path";
import { codedError } from "../../../../shared/coded-error";

interface WorkingFolderDeclaration {
    readonly value: string;
    readonly generation: number;
    readonly frame: HTMLIFrameElement;
}

const workingFolders = new WeakMap<BoardEditorModel, BoardWorkingFolder>();

/** Transient, generation-scoped working-folder declaration for one board editor. */
export class BoardWorkingFolder {
    private declaration: WorkingFolderDeclaration | undefined;

    get value(): string | undefined {
        return this.declaration?.value;
    }

    async set(
        path: unknown,
        context: BoardMessageContext,
        session: BoardFrameSession,
        isTrusted: () => boolean,
    ): Promise<void> {
        this.assertCurrent(context, session, isTrusted);
        if (path === null || path === undefined) {
            this.declaration = undefined;
            return;
        }
        if (typeof path !== "string" || path.length === 0) {
            throw new TypeError("setWorkingFolder() requires an absolute directory path, or null to clear it.");
        }
        if (!fpIsAbsolute(path) || isArchivePath(path)) {
            throw new Error("setWorkingFolder() requires an absolute ordinary filesystem directory path.");
        }

        const stat = await appFs.stat(path);
        if (!stat.exists) throw new Error(`setWorkingFolder(): directory does not exist: ${path}`);
        if (!stat.isDirectory) throw new Error(`setWorkingFolder(): path is not a directory: ${path}`);

        this.assertCurrent(context, session, isTrusted);
        this.declaration = { value: path, generation: context.generation, frame: context.frame };
    }

    clearGeneration(generation: number): void {
        if (this.declaration?.generation === generation) this.declaration = undefined;
    }

    clear(): void {
        this.declaration = undefined;
    }

    private assertCurrent(
        context: BoardMessageContext,
        session: BoardFrameSession,
        isTrusted: () => boolean,
    ): void {
        if (!session.isCurrent(context.generation, context.frame) || !isTrusted()) {
            throw codedError("untrusted", "This board frame is no longer trusted.");
        }
    }
}

export function getBoardWorkingFolder(model: BoardEditorModel): BoardWorkingFolder {
    let workingFolder = workingFolders.get(model);
    if (!workingFolder) {
        workingFolder = new BoardWorkingFolder();
        workingFolders.set(model, workingFolder);
    }
    return workingFolder;
}
