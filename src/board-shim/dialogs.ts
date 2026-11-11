import { BOARD_DIALOG_MAX_BYTES, BOARD_DIALOG_PATH } from "../ipc/board-bridge/origin-routes";
import type { BoardDialogKind, BoardDialogXhrRequest } from "../ipc/board-bridge/origin-routes";

function boardDialog(type: BoardDialogKind, message: string, defaultPrompt = ""): unknown {
    try {
        const identity = new URL(location.href);
        const body: BoardDialogXhrRequest = {
            type, message, defaultPrompt, url: location.href,
            nonce: identity.searchParams.get("v"), view: identity.searchParams.get("view") ?? "main",
        };
        const payload = JSON.stringify(body);
        if (new TextEncoder().encode(payload).length > BOARD_DIALOG_MAX_BYTES) return null;
        const request = new XMLHttpRequest();
        request.open("POST", `${location.protocol}//${location.host}${BOARD_DIALOG_PATH}`, false);
        request.setRequestHeader("Content-Type", "application/json");
        request.send(payload);
        return request.status === 200 ? JSON.parse(request.responseText) : null;
    } catch {
        return null;
    }
}

export function installBoardDialogs(): void {
    window.alert = (message?: unknown): void => { boardDialog("alert", String(message ?? "")); };
    window.confirm = (message?: string): boolean => boardDialog("confirm", String(message ?? "")) === true;
    window.prompt = (message?: string, defaultValue?: string): string | null => {
        const result = boardDialog("prompt", String(message ?? ""), String(defaultValue ?? ""));
        return typeof result === "string" ? result : null;
    };
}
