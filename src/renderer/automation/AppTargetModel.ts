import type { IBrowserTarget, IInputPoint, ITargetTab } from "./types";
import { CdpSession } from "./CdpSession";
import { APP_WINDOW_CDP_KEY } from "../../ipc/api-types";

/**
 * `IBrowserTarget` adapter for Persephone's OWN main window (US-810), letting the
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
 * Navigation and tab methods throw a clear error: the app window has no browser-style
 * navigation or tabs — opening and switching Persephone pages is done through `pages`
 * (`pages.showPage(id)`).
 *
 * Exposed as a module-level singleton — there is exactly one app UI per renderer, and
 * the sentinel key resolves to whichever window handled the MCP command.
 */
const NAV_MSG =
    "Navigation is not supported on the app window (pageId: \"app\") — it is Persephone's own UI, " +
    "not a browser page. To open or switch pages, read `pages` and call `pages.showPage(pageId)`.";
const TAB_MSG =
    "Tabs are not supported on the app window (pageId: \"app\"). Persephone's page tabs are not " +
    "browser tabs — read `pages` to list them and `pages.showPage(pageId)` to switch.";

class AppTargetModel implements IBrowserTarget {
    get id(): string {
        return "app";
    }

    cdp(): CdpSession {
        return new CdpSession(APP_WINDOW_CDP_KEY);
    }

    inputCdp(_tabId?: string, sessionId?: string) {
        return {
            cdp: this.cdp(),
            sessionId,
            mapPoint: (point: IInputPoint, offsets: ReadonlyArray<IInputPoint> = []) => offsets.reduce(
                (mapped, offset) => ({ x: mapped.x + offset.x, y: mapped.y + offset.y }), point,
            ),
        };
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

    navigate(): void {
        throw new Error(NAV_MSG);
    }
    back(): void {
        throw new Error(NAV_MSG);
    }
    forward(): void {
        throw new Error(NAV_MSG);
    }
    reload(): void {
        // Reloading the app window is deliberately NOT exposed to the agent.
        throw new Error(NAV_MSG);
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

    addTab(): string {
        throw new Error(TAB_MSG);
    }
    closeTab(): void {
        throw new Error(TAB_MSG);
    }
    switchTab(): void {
        throw new Error(TAB_MSG);
    }
}

/** Singleton app-window automation target (there is one app UI per renderer). */
export const appTarget = new AppTargetModel();
