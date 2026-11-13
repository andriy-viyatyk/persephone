const { ipcRenderer } = require("electron"); // eslint-disable-line @typescript-eslint/no-var-requires
import { BoardDialogChannel, type BoardDialogRecord } from "../../../ipc/board-dialog-ipc";


export async function boardDialogs(editorId: string, tabId: string): Promise<BoardDialogRecord[]> {
    const records = await ipcRenderer.invoke(BoardDialogChannel.list) as BoardDialogRecord[];
    return records.filter(record => record.key === `${editorId}/${tabId}`);
}

export async function answerBoardDialog(editorId: string, tabId: string, accept: boolean, promptText?: string): Promise<void> {
    const record = (await boardDialogs(editorId, tabId)).find(item => item.disposition === "pending");
    if (!record) throw new Error("No pending board dialog is open in this view.");
    await ipcRenderer.invoke(BoardDialogChannel.answer, record.id, accept, promptText);
}
