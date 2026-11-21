import { BrowserWindow, dialog, WebContents, WebFrameMain } from "electron";
import { t } from "../../shared/i18n/t";
import { withNativeDialog } from "../native-dialog-tracker";

/**
 * Electron answers a page's `alert()`/`confirm()`/`prompt()` in its own JavaScript through this internal
 * WebContents event — the same place `disableDialogs` and `safeDialogs` are read.
 */
const RUN_DIALOG_EVENT = "-run-dialog";
/** Emitted by Electron when the page navigates or closes; open boxes of that page are dismissed. */
const CANCEL_DIALOGS_EVENT = "-cancel-dialogs";
const MAX_MESSAGE_CHARS = 2000;

interface RunDialogInfo {
    frame?: WebFrameMain | null;
    dialogType: "alert" | "confirm" | "prompt";
    messageText: string;
}
type RunDialogCallback = (success: boolean, userInput: string) => void;
interface InternalDialogEvents {
    listenerCount(event: string): number;
    removeAllListeners(event: string): void;
    on(event: string, listener: (...args: never[]) => void): void;
}

/**
 * Web preferences of a browser `<webview>`: Electron's own consecutive-dialog protection, the fallback
 * for when `guardPageDialogs` cannot take over Electron's handler.
 */
export function applyPageDialogPreferences(webPreferences: Electron.WebPreferences): void {
    webPreferences.safeDialogs = true;
    webPreferences.safeDialogsMessage = t("main.preventMoreDialogs");
}

function frameOrigin(frame: WebFrameMain | null | undefined): string {
    try {
        const origin = frame?.origin;
        if (origin && origin !== "null") return origin;
        return frame?.url ? new URL(frame.url).protocol : "";
    } catch {
        return "";
    }
}

/**
 * JavaScript dialogs of a browser page (a `<webview>` guest or one of its popup windows).
 *
 * In a guest the page does not wait for the answer, so a loop of `alert()` would stack an unbounded
 * number of native boxes. This replaces Electron's handler for the page: one native box at a time
 * (a dialog raised while one is open is answered "cancel" at once, with no box), titled with the
 * requesting frame's origin, and from the second box on a checkbox that silences the origin for the
 * page's lifetime (Electron's `safeDialogs`). `prompt()` stays unsupported, as in Electron. If Electron
 * no longer registers the internal event, its own handler (with `safeDialogs` set on browser webviews)
 * remains in charge.
 */
export function guardPageDialogs(contents: WebContents): void {
    const events = contents as unknown as InternalDialogEvents;
    if (events.listenerCount(RUN_DIALOG_EVENT) === 0) return;
    events.removeAllListeners(RUN_DIALOG_EVENT);
    const shownByOrigin = new Map<string, number>();
    const silencedOrigins = new Set<string>();
    let open: AbortController | undefined;

    events.on(CANCEL_DIALOGS_EVENT, (() => { open?.abort(); }) as (...args: never[]) => void);
    events.on(RUN_DIALOG_EVENT, ((info: RunDialogInfo, callback: RunDialogCallback) => {
        const origin = frameOrigin(info?.frame);
        if (open || silencedOrigins.has(origin) || info?.dialogType === "prompt") {
            callback(false, "");
            return;
        }
        const shown = (shownByOrigin.get(origin) ?? 0) + 1;
        shownByOrigin.set(origin, shown);
        const controller = new AbortController();
        open = controller;
        const host = (contents as WebContents & { hostWebContents?: WebContents }).hostWebContents ?? contents;
        const parent = BrowserWindow.fromWebContents(host) ?? undefined;
        const confirm = info.dialogType === "confirm";
        const options: Electron.MessageBoxOptions = {
            title: origin,
            message: String(info.messageText ?? "").slice(0, MAX_MESSAGE_CHARS),
            buttons: confirm ? [t("common.ok"), t("common.cancel")] : [t("common.ok")],
            defaultId: 0,
            cancelId: confirm ? 1 : 0,
            checkboxLabel: shown > 1 ? t("main.preventMoreDialogs") : undefined,
            signal: controller.signal,
        };
        void withNativeDialog(parent, "messageBox", () => parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
            .then((result) => {
                if (result.checkboxChecked) silencedOrigins.add(origin);
                if (!controller.signal.aborted && !contents.isDestroyed()) callback(result.response === 0, "");
            })
            .catch((): void => undefined)
            .finally(() => { if (open === controller) open = undefined; });
    }) as (...args: never[]) => void);
}
