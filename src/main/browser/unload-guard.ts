import { BrowserWindow, dialog, WebContents } from "electron";
import type { BrowserNavigationIntent } from "../../ipc/browser-ipc";
import { t } from "../../shared/i18n/t";
import { withNativeDialog } from "../native-dialog-tracker";
import { hasRecentRendererRequest } from "../renderer-rpc";

/** How long a recorded navigation request is taken to be what a `beforeunload` cancelled. */
const INTENT_FRESH_MS = 3000;
/** After "Leave" with nothing to repeat, the user's next attempt within this window leaves without asking. */
const UNKNOWN_INTENT_BYPASS_MS = 10_000;

/**
 * The unsaved-changes confirm of one browser tab: a page whose `beforeunload` handler cancels a reload or
 * navigation.
 *
 * Electron wants the answer to `will-prevent-unload` synchronously, and a synchronous message box would
 * freeze the main process (every window, IPC and MCP) while it is up. So the guard keeps the page, asks
 * asynchronously (one box at a time; attempts while it is open just stay), and on "Leave" repeats the
 * navigation that was cancelled with a one-shot bypass armed. The navigation is known from the intent
 * recorded just before it: the page's own `will-navigate`, the guest's F5/Ctrl+R/Alt+arrow keys, or the
 * host's load/back/forward/reload (`BrowserChannel.navigationIntent`). A hard reload arms the bypass
 * directly. Agent-driven navigations (a pending renderer request) are never asked about.
 */
export class BrowserUnloadGuard {
    private intent: { value: BrowserNavigationIntent; at: number } | undefined;
    private bypassUntil = 0;
    private asking = false;

    constructor(private readonly contents: WebContents, private readonly hostContents: WebContents) {}

    noteIntent(intent: BrowserNavigationIntent): void {
        this.intent = { value: intent, at: Date.now() };
    }

    armBypass(durationMs = UNKNOWN_INTENT_BYPASS_MS): void {
        this.bypassUntil = Date.now() + durationMs;
    }

    clearBypass(): void {
        this.bypassUntil = 0;
    }

    handleWillPreventUnload(event: Electron.Event): void {
        if (Date.now() <= this.bypassUntil || hasRecentRendererRequest()) {
            this.bypassUntil = 0;
            event.preventDefault();
            return;
        }
        const intent = this.intent && Date.now() - this.intent.at <= INTENT_FRESH_MS ? this.intent.value : undefined;
        this.intent = undefined;
        if (this.asking) return;
        this.asking = true;
        void this.ask(intent).finally(() => { this.asking = false; });
    }

    private async ask(intent: BrowserNavigationIntent | undefined): Promise<void> {
        const parent = this.hostContents.isDestroyed() ? undefined : BrowserWindow.fromWebContents(this.hostContents) ?? undefined;
        const options: Electron.MessageBoxOptions = {
            type: "question", buttons: [t("main.unsavedChangesLeave"), t("main.unsavedChangesCancel")],
            defaultId: 1, cancelId: 1, title: t("main.unsavedChangesTitle"), message: t("main.unsavedChangesMessage"),
        };
        const result = await withNativeDialog(parent, "messageBox", () => parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
            .catch((): undefined => undefined);
        if (result?.response !== 0 || this.contents.isDestroyed()) return;
        this.armBypass();
        if (intent) this.replay(intent);
    }

    private replay(intent: BrowserNavigationIntent): void {
        const contents = this.contents;
        if (intent.kind === "load") void contents.loadURL(intent.url).catch((): void => undefined);
        else if (intent.kind === "reload") contents.reload();
        else if (intent.kind === "back") contents.navigationHistory.goBack();
        else contents.navigationHistory.goForward();
    }
}
