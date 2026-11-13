import type { IAutomationTarget, ISyntheticInputHost, ITabInfoTarget, ITargetTab } from "./types";
import { createInputSession } from "./input-session";
import { CdpSession } from "./CdpSession";
import { APP_WINDOW_CDP_KEY } from "../../ipc/api-types";

/**
 * Automation adapter for Persephone's OWN main window, letting the
 * shared automation operations drive the app's own UI through `window.screen` — page
 * tabs, sidebar, toolbars, dialogs, and the active editor. Selected explicitly via
 * `window.screen` or the explicit `pageId: "app"` target.
 *
 * The app window is a single top-level document with no tabs and no navigation, so
 * only the page-interaction surface is real:
 *  • `cdp()` — a session keyed by the `APP_WINDOW_CDP_KEY` sentinel that main routes
 *    to the calling window's own top-level webContents (snapshot / click / type /
 *    press-key / evaluate / screenshot).
 *  • `focusWebview()` — a no-op. Trusted mouse input is sent through CDP and needs no OS
 *    focus; the existing keyboard path also avoids stealing the user's window focus.
 *  • `insertText()` — legacy insertion seam used only by explicit synthetic input.
 * Navigation and tab mutation are intentionally absent: pages are managed through `pages`.
 *
 * Exposed as a module-level singleton — there is exactly one app UI per renderer, and
 * the sentinel key resolves to whichever window handled the MCP command.
 */
class AppTargetModel implements IAutomationTarget, ISyntheticInputHost, ITabInfoTarget {
    get id(): string {
        return "app";
    }

    cdp(): CdpSession {
        return new CdpSession(APP_WINDOW_CDP_KEY);
    }

    inputCdp(_tabId?: string, sessionId?: string) {
        return createInputSession(this.cdp(), sessionId);
    }

    focusWebview(): void {
        // No-op — trusted CDP mouse input needs no OS focus, and we must not steal the
        // user's window focus while they work.
    }

    async insertText(text: string): Promise<void> {
        // Insert at the currently focused element (input.ts has already focused the
        // target) via the app-window CDP session.
        await this.cdp().evaluate(`document.execCommand('insertText', false, ${JSON.stringify(text)})`);
    }

    get tabs(): ReadonlyArray<ITargetTab> {
        return [
            {
                id: "app",
                url: "app://main-window",
                title: "Persephone",
                loading: false,
                active: true,
            },
        ];
    }

    get activeTab(): ITargetTab | undefined {
        return this.tabs[0];
    }

}

/** Singleton app-window automation target (there is one app UI per renderer). */
export const appTarget = new AppTargetModel();
