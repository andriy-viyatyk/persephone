import { BoardDialogChannel, type BoardDialogRecord } from "../../../ipc/board-dialog-ipc";
import { dialogsState } from "./Dialogs";
import { showConfirmationDialog } from "./ConfirmationDialog";
import { showInputDialog } from "./InputDialog";
import { DialogButton } from "./dialog-buttons";

const { ipcRenderer } = require("electron"); // eslint-disable-line @typescript-eslint/no-var-requires

export function installBoardDialogController(): () => void {
    let activeId: string | undefined;
    let closeActive: (() => void) | undefined;
    let queue: BoardDialogRecord[] = [];
    let disposed = false;
    let receivedChange = false;

    const advance = (): void => {
        if (disposed || activeId || !queue.length) return;
        const record = queue[0];
        activeId = record.id;
        // The title names the board; the frame identity stays in `record.key` for the facade's
        // dialogs(), so the user sees only the board's own message.
        const message = record.message;
        const before = new Set(dialogsState.get());
        const answer = record.type === "prompt"
            ? showInputDialog({ title: record.title, message, value: record.defaultPrompt, allowEmpty: true, buttons: [DialogButton.ok, DialogButton.cancel] }).then(result => ({ accept: result?.button === DialogButton.ok, text: result?.value }))
            : showConfirmationDialog({ title: record.title, message, buttons: record.type === "alert" ? [DialogButton.ok] : [DialogButton.ok, DialogButton.cancel] }).then(result => ({ accept: result === DialogButton.ok, text: undefined as string | undefined }));
        const dialog = dialogsState.get().find(item => !before.has(item));
        closeActive = () => { dialog?.model.close(undefined); };
        void answer.then(result => {
            if (activeId !== record.id) return;
            void ipcRenderer.invoke(BoardDialogChannel.answer, record.id, result.accept, result.text);
        });
    };
    const changed = (_event: unknown, records: BoardDialogRecord[]): void => {
        receivedChange = true;
        queue = records;
        if (activeId && !queue.some(record => record.id === activeId)) {
            activeId = undefined;
            closeActive?.();
            closeActive = undefined;
        }
        advance();
    };
    ipcRenderer.on(BoardDialogChannel.changed, changed);
    void ipcRenderer.invoke(BoardDialogChannel.list).then((records: BoardDialogRecord[]) => {
        if (!disposed && !receivedChange) changed(undefined, records.filter(record => record.disposition === "pending"));
    });
    return () => {
        disposed = true;
        ipcRenderer.removeListener(BoardDialogChannel.changed, changed);
        activeId = undefined;
        closeActive?.();
    };
}
