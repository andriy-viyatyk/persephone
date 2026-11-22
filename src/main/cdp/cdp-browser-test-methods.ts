import type { WebContents } from "electron";
import type {
    CdpAttachOptions,
    BrowserDownloadWaitRequest,
    BrowserInitScriptRemovalRequest,
    BrowserInitScriptRequest,
    BrowserInitScriptTargetRequest,
    BrowserRouteRemovalRequest,
    BrowserRouteRequest,
    BrowserSetStorageCookiesRequest,
    BrowserStorageCookiesRequest,
} from "../../ipc/browser-ipc";
import { browserGuests } from "../browser/BrowserGuestRegistry";
import { downloadCapture } from "../download-capture";
import type { BoardFrameRegistration } from "../board-host/BoardFrameRegistry";
import type { CdpFeatureTarget } from "./CdpTarget";
import * as cdpAiVisionBinding from "./cdp-ai-vision-binding";
import * as cdpInitScripts from "./cdp-init-scripts";
import * as cdpPageEvents from "./cdp-page-events";
import * as cdpRequestRoutes from "./cdp-request-routes";
import * as cdpStorageState from "./cdp-storage-state";

type TargetResolver = (key: string, sender: WebContents | undefined, scope?: "all" | "browser-only") => CdpFeatureTarget;
type BoardSessionResolver = (registration: BoardFrameRegistration) => Promise<string | undefined>;

export function clearBrowserTestCdpState(key: string): void {
    cdpInitScripts.clearKey(key);
    cdpRequestRoutes.clearKey(key);
}

export function onBrowserTestTargetAttached(webContents: WebContents, target: CdpFeatureTarget): void {
    cdpInitScripts.onTargetAttached(webContents);
    const guest = browserGuests.getByWebContents(webContents);
    if (guest) cdpRequestRoutes.onTargetAttached(guest.key, webContents, target.attach(webContents));
}

export function onBrowserTestTargetDetached(webContents: WebContents): void {
    cdpInitScripts.onTargetDetached(webContents);
    cdpRequestRoutes.onTargetDetached(webContents);
}

export async function restoreBrowserTestTargetState(
    key: string,
    webContents: WebContents,
    target: CdpFeatureTarget,
    resolveBoardSession: BoardSessionResolver,
): Promise<void> {
    const cdp = target.attach(webContents);
    await cdpInitScripts.restoreInitScripts({ key, webContents, cdp },
        () => cdpPageEvents.preparePageErrorCapture(key, target, resolveBoardSession));
    await cdpRequestRoutes.restoreRoutes(key, webContents, cdp);
}

export function createCdpLifecycleMethods(
    resolveTarget: TargetResolver,
    resolveBoardSession: BoardSessionResolver,
    onAiVisionSignal: ((webContents: WebContents, payload: string, executionContextId: number, mainContext: boolean) => void) | undefined,
    clearTransientTargetState: (key: string) => void,
) {
    return {
        async cdpAttach(event: Electron.IpcMainInvokeEvent, key: string, options?: CdpAttachOptions): Promise<boolean> {
            const target = resolveTarget(key, event.sender);
            if (target.kind === "app") {
                const wc = target.webContents;
                if (!wc || wc.isDestroyed()) return false;
                try { target.attach(wc); return true; } catch { return false; }
            }
            if (target.kind === "board") {
                if (target.registration.host.isDestroyed()) return false;
                try { target.attach(target.registration.host); return true; } catch { return false; }
            }
            const wc = target.webContents;
            if (!wc || wc.isDestroyed()) return false;
            if (options?.aiVisionBinding === true && !onAiVisionSignal) return false;
            try {
                target.attach(wc);
                await restoreBrowserTestTargetState(key, wc, target, resolveBoardSession);
                if (options?.aiVisionBinding === true && onAiVisionSignal) {
                    await cdpAiVisionBinding.ensureAiVisionBinding(wc, target.attach, onAiVisionSignal);
                }
                return true;
            } catch { return false; }
        },
        async cdpDetach(key: string): Promise<void> {
            const target = resolveTarget(key, undefined);
            if (target.kind === "app") return;
            if (target.kind === "board") {
                target.registration.sessionId = undefined;
                clearTransientTargetState(key);
                return;
            }
            const wc = target.webContents;
            if (!wc || wc.isDestroyed() || !target.cdp?.attached) return;
            target.cdp.detach();
            cdpAiVisionBinding.clearAiVisionBinding(wc);
            clearTransientTargetState(key);
        },
    };
}

function browserTarget(resolveTarget: TargetResolver, key: string, sender: WebContents | undefined) {
    const target = resolveTarget(key, sender, "browser-only");
    const webContents = target.webContents;
    if (target.kind !== "browser" || !webContents || webContents.isDestroyed()) {
        throw new Error("WebContents not found or destroyed");
    }
    return { target, webContents };
}

/** Request handlers for the browser test-power CDP features composed by cdp-service. */
export function createBrowserTestCdpMethods(resolveTarget: TargetResolver, resolveBoardSession: BoardSessionResolver) {
    return {
        waitForDownload(event: Electron.IpcMainInvokeEvent, request: BrowserDownloadWaitRequest) {
            if (!browserGuests.owned(request?.registrationKey, event.sender)) {
                throw new Error("Browser page is closed or does not belong to this window.");
            }
            const { webContents } = browserTarget(resolveTarget, request.registrationKey, event.sender);
            return downloadCapture.wait(webContents, request.options);
        },
        async addInitScript(event: Electron.IpcMainInvokeEvent, request: BrowserInitScriptRequest): Promise<string> {
            const { registrationKey: key, source } = request;
            const { target, webContents } = browserTarget(resolveTarget, key, event.sender);
            return cdpInitScripts.registerInitScript({ key, webContents, cdp: target.attach(webContents) }, source,
                () => cdpPageEvents.preparePageErrorCapture(key, target, resolveBoardSession));
        },
        async removeInitScript(event: Electron.IpcMainInvokeEvent, request: BrowserInitScriptRemovalRequest): Promise<boolean> {
            const { registrationKey: key, id } = request;
            const { target, webContents } = browserTarget(resolveTarget, key, event.sender);
            return cdpInitScripts.removeInitScript({ key, webContents, cdp: target.attach(webContents) }, id);
        },
        async clearInitScripts(event: Electron.IpcMainInvokeEvent, request: BrowserInitScriptTargetRequest): Promise<number> {
            const { registrationKey: key } = request;
            const { target, webContents } = browserTarget(resolveTarget, key, event.sender);
            return cdpInitScripts.clearInitScripts({ key, webContents, cdp: target.attach(webContents) });
        },
        async getStorageStateCookies(event: Electron.IpcMainInvokeEvent, request: BrowserStorageCookiesRequest) {
            const { target, webContents } = browserTarget(resolveTarget, request.registrationKey, event.sender);
            return cdpStorageState.getCookies({ webContents, cdp: target.attach(webContents) }, request.urls);
        },
        async setStorageStateCookies(event: Electron.IpcMainInvokeEvent, request: BrowserSetStorageCookiesRequest): Promise<void> {
            const { target, webContents } = browserTarget(resolveTarget, request.registrationKey, event.sender);
            await cdpStorageState.setCookies({ webContents, cdp: target.attach(webContents) }, request.cookies);
        },
        async addRequestRoute(event: Electron.IpcMainInvokeEvent, request: BrowserRouteRequest): Promise<void> {
            const { target, webContents } = browserTarget(resolveTarget, request.registrationKey, event.sender);
            await cdpRequestRoutes.addRoute(request.registrationKey, webContents, target.attach(webContents), request);
        },
        async removeRequestRoutes(event: Electron.IpcMainInvokeEvent, request: BrowserRouteRemovalRequest): Promise<void> {
            const { target, webContents } = browserTarget(resolveTarget, request.registrationKey, event.sender);
            await cdpRequestRoutes.removeRoutes(request.registrationKey, webContents, target.attach(webContents), request);
        },
    };
}
