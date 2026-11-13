import { BoardDialogChannel } from "../board-dialog-ipc";
import { answerForSender, listForSender } from "../../main/board-dialog-service";
import { guardedIpcHandle } from "../../main/ipc-sender-guard";

export function initBoardDialogHandlers(): void {
    guardedIpcHandle(BoardDialogChannel.list, event => listForSender(event.sender));
    guardedIpcHandle(BoardDialogChannel.answer, (event, id: string, accept: boolean, text?: string) =>
        answerForSender(event.sender, id, accept, text));
}
