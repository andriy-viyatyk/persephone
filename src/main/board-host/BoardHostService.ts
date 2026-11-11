import type { WebContents } from "electron";
import { BOARD_CDP_TAB } from "../../ipc/api-types";
import type { BoardHostText, BoardI18nContext, BoardThemePalette } from "../../ipc/board-bridge/boot";
import * as boardBridge from "../board-bridge";
import { cancelBoardDialogs } from "../board-dialog-service";
import { registerBoard, unregisterBoard, updateAllBoardThemes } from "../board-protocol-service";
import { boardFrameRegistry } from "./BoardFrameRegistry";
import { clearCdpTargetState } from "../cdp-service";

/** Coordinates main-process board host lifecycle across its owning services. */
export class BoardHostService {
    public mount(
        sender: WebContents,
        boardRoot: string,
        theme: BoardThemePalette,
        tokens: Record<string, string>,
        i18n: BoardI18nContext,
        hostText: BoardHostText,
    ): string {
        let hostOrigin = "";
        try {
            hostOrigin = new URL(sender.getURL()).origin;
        } catch {
            // Leave empty: the shim falls back to its parent-frame check.
        }
        const host = registerBoard(boardRoot, theme, tokens, i18n, hostText, hostOrigin);
        boardBridge.ensureHostWired(sender);
        return host;
    }

    public unregisterBoard(host: string): void {
        unregisterBoard(host);
    }

    public setTheme(theme: BoardThemePalette): void {
        updateAllBoardThemes(theme);
        boardBridge.pushThemeToBoards(theme);
    }

    public requestBoardPort(
        sender: WebContents,
        boardId: string,
        host: string,
        ownerId: string,
        hostedPath: string | null,
        token: string,
    ): void {
        boardBridge.createBoardPort(sender, boardId, host, ownerId, hostedPath, token);
    }

    public updateBoardHostedPath(
        sender: WebContents,
        boardId: string,
        token: string,
        hostedPath: string | null,
    ): boolean {
        return boardBridge.updateBoardHostedPath(sender, boardId, token, hostedPath);
    }

    public disposeBoardPort(boardId: string): void {
        boardBridge.disposeBoardPort(boardId);
    }

    public setBoardBusy(ownerId: string, busy: boolean): void {
        boardBridge.setBoardBusy(ownerId, busy);
    }

    public setBoardCallTimeout(timeoutMs: number): void {
        boardBridge.setBoardCallTimeout(timeoutMs);
    }

    public reapBoardOwner(ownerId: string): void {
        boardBridge.reapBoardOwner(ownerId);
    }

    public registerBoardFrame(
        sender: WebContents,
        boardId: string,
        boardHost: string,
        frameNonce?: string,
        tab: string = BOARD_CDP_TAB,
        title?: string,
        pageId?: string,
    ): void {
        const key = `${boardId}/${tab}`;
        const previous = boardFrameRegistry.register(key, sender, boardHost, frameNonce, title, pageId);
        if (previous && (previous.host !== sender || previous.boardHost !== boardHost || previous.frameNonce !== frameNonce)) {
            cancelBoardDialogs(key);
        }
    }

    public unregisterBoardFrame(
        boardId: string,
        tab: string = BOARD_CDP_TAB,
        frameNonce?: string,
    ): void {
        const key = `${boardId}/${tab}`;
        if (boardFrameRegistry.unregister(key, frameNonce)) {
            cancelBoardDialogs(key);
            clearCdpTargetState(key);
        }
    }
}

export const boardHostService = new BoardHostService();
