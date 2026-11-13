import { BoardRoot } from "../../../shared/board/board-root";
import { parseBoardEditorId } from "../../../shared/board/board-editor-id";
import { hostOwnsPipe } from "../../../shared/board/board-manifest-queries";
import { EditorId } from "../../../shared/editor-ids";
import { DisposableStore } from "../../core/utils/DisposableStore";
import { fpBasename, isPlainLocalPath } from "../../core/utils/file-path";
import { englishMessage } from "../../../shared/i18n/t";
import { boardDisplayText, onBoardDisplayTextChanged } from "./board-display-text";
import { boardInstallRegistry } from "./board-install-registry";
import { customEditorRegistry, type CustomEditorMatch } from "./custom-editor-registry";
import { publishedBoards } from "./published-boards";
import { BOARD_INFO_EDITOR_ID } from "../../editors/board-info/board-info-id";
import type { EditorCandidate, EditorDescription, EditorResolution, EditorSource } from "../../editors/base/editor-catalog";
import type { EditorModelInstance as EditorModel } from "../../editors/base/EditorModel";

function priorityFor(match: CustomEditorMatch): number { return match.priority; }
function transitionFor(match: CustomEditorMatch): "host-transfer" | "rebuild" {
    return match.editorKind === "content-host" ? "host-transfer" : "rebuild";
}
function candidateFor(match: CustomEditorMatch): EditorCandidate {
    return {
        id: match.editorId,
        label: match.name,
        displayLabel: boardDisplayText(match.boardRoot, undefined, match.displayNameKey, match.name),
        boardRoot: BoardRoot.from(match.boardRoot).path,
        transition: transitionFor(match),
    };
}

/** Board-owned adapter for the catalog. Matching and trust rules remain in board registries. */
export class BoardEditorSource implements EditorSource {
    resolveFile(filePath: string, matchPath = filePath): EditorResolution | undefined {
        const local = isPlainLocalPath(filePath);
        const boards = customEditorRegistry.getBoardsForFile(matchPath).filter((board) =>
            local || hostOwnsPipe(board.editorKind) || board.editorSources === "any"
        );
        const winner = boards[0] ? boards.reduce((best, item) =>
            item.priority > best.priority ? item : best) : undefined;
        return winner ? { id: winner.editorId, priority: priorityFor(winner) } : undefined;
    }

    resolveFolder(folderPath: string): EditorResolution | undefined {
        const board = customEditorRegistry.getBoardsForFolder(folderPath).reduce<CustomEditorMatch | undefined>(
            (best, item) => !best || item.folderEditorPriority > best.folderEditorPriority ? item : best,
            undefined,
        );
        return board ? { id: board.editorId, priority: board.folderEditorPriority } : undefined;
    }

    candidatesForFile(filePath: string): readonly EditorCandidate[] {
        const local = isPlainLocalPath(filePath);
        return customEditorRegistry.getBoardsForFileName(fpBasename(filePath))
            .filter((board) => local || hostOwnsPipe(board.editorKind) || board.editorSources === "any")
            .map(candidateFor);
    }

    candidatesForFolder(folderPath: string): readonly EditorCandidate[] {
        return customEditorRegistry.getBoardsForFolder(folderPath).map(candidateFor);
    }

    switchCandidates(model: EditorModel): readonly EditorCandidate[] {
        const folderPath = model.folderAnchor;
        if (folderPath !== undefined) {
            const matches = customEditorRegistry.getBoardsForFolder(folderPath);
            const candidates = matches.map(candidateFor);
            const trustedRoots = new Set(matches.map(({ boardRoot }) => BoardRoot.from(boardRoot).key));
            const catalogMatches = publishedBoards.catalogBoardsForFolder(folderPath).filter((board) => {
                const installed = boardInstallRegistry.listInstalled().find(({ id }) => id === board.id);
                return !installed || !trustedRoots.has(BoardRoot.from(installed.root).key);
            });
            if (model.editorId === BOARD_INFO_EDITOR_ID || catalogMatches.length > 0) candidates.push(this.installCandidate("folder"));
            return candidates;
        }

        const filePath = model.filePath;
        const fileName = filePath ?? model.displayTitle;
        const local = !filePath || isPlainLocalPath(filePath);
        const host = model.contentHost;
        const matching = customEditorRegistry.getBoardsForFile(fileName);
        for (const board of customEditorRegistry.getBoardsForContent(host?.state.get().content ?? "")) {
            if (!matching.some(({ editorId }) => editorId === board.editorId)) matching.push(board);
        }
        const boards = matching.filter((board) => local || hostOwnsPipe(board.editorKind));
        const trustedRoots = new Set(boards.map(({ boardRoot }) => BoardRoot.from(boardRoot).key));
        const catalogMatches = publishedBoards.catalogBoardsForFile(fileName).filter((board) => {
            if (!local && !hostOwnsPipe(board.editorKind)) return false;
            const installed = boardInstallRegistry.listInstalled().find(({ id }) => id === board.id);
            return !installed || !trustedRoots.has(BoardRoot.from(installed.root).key);
        });
        const candidates = boards.map(candidateFor);
        if (model.editorId === BOARD_INFO_EDITOR_ID || catalogMatches.length > 0) candidates.push(this.installCandidate("file"));
        return candidates;
    }

    candidateById(id: string, _model: EditorModel): EditorCandidate | undefined {
        if (id === BOARD_INFO_EDITOR_ID) return this.installCandidate("file");
        const match = customEditorRegistry.findByEditorId(id);
        return match ? candidateFor(match) : undefined;
    }

    describe(id: string): EditorDescription | undefined {
        const root = parseBoardEditorId(id);
        if (root === null) return undefined;
        const match = customEditorRegistry.findByEditorId(id);
        if (!match) return { label: fpBasename(root), boardRoot: BoardRoot.from(root).path };
        return { label: match.name,
            displayLabel: boardDisplayText(match.boardRoot, undefined, match.displayNameKey, match.name),
            boardRoot: BoardRoot.from(match.boardRoot).path };
    }

    subscribe(listener: () => void): () => void {
        const subscriptions = new DisposableStore();
        subscriptions.add(customEditorRegistry.state.subscribe(listener, (state) => state.entries));
        subscriptions.add(boardInstallRegistry.subscribeInstalled(listener));
        subscriptions.add(publishedBoards.subscribeCatalog(listener));
        subscriptions.add(onBoardDisplayTextChanged(() => listener()));
        return () => subscriptions.dispose();
    }

    private installCandidate(kind: "file" | "folder"): EditorCandidate {
        const key = kind === "file" ? "shell.installEditorForFileType" : "shell.installEditorForFolder";
        return { id: EditorId.boardInfo, label: "\u00A0\u00A0+\u00A0\u00A0",
            title: englishMessage(key), labelKey: undefined, titleKey: key, transition: "install" };
    }
}

export const boardEditorSource = new BoardEditorSource();
