/**
 * CDP session wrapper for a browser webview.
 * Sends Chrome DevTools Protocol commands via IPC to the main process,
 * which forwards them through Electron's webContents.debugger API.
 */
import { BrowserChannel, type BrowserInitScriptId, type BrowserInitScriptRemovalRequest, type BrowserInitScriptRequest, type BrowserInitScriptTargetRequest, type BrowserKeyboardInputEvent, type CdpAttachOptions, type NavigationWaitResult, type BrowserResponsePattern, type BrowserResponseWaitOptions, type BrowserResponseResult, type BrowserCookie, type BrowserStorageCookiesRequest, type BrowserSetStorageCookiesRequest, type BrowserDownloadWaitOptions, type BrowserDownloadResult, type BrowserDownloadWaitRequest, type BrowserRouteRequest, type BrowserRouteRemovalRequest } from "../../ipc/browser-ipc";
import { errMessage } from "../../shared/utils";

const { ipcRenderer } = require("electron");

export class CdpSession {
    constructor(private readonly regKey: string) {}

    /** Exact registration key used by the main-process CDP router. */
    get registrationKey(): string {
        return this.regKey;
    }

    async attach(options?: CdpAttachOptions): Promise<boolean> {
        return ipcRenderer.invoke(BrowserChannel.cdpAttach, this.regKey, options);
    }

    async detach(): Promise<void> {
        return ipcRenderer.invoke(BrowserChannel.cdpDetach, this.regKey);
    }

    /** Send a raw CDP command. Auto-attaches if not yet attached. */
    async send(method: string, params?: object, sessionId?: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
        return invokeUnwrapped(BrowserChannel.cdpSend, this.regKey, method, params, sessionId);
    }

    addInitScript(source: string): Promise<BrowserInitScriptId> {
        const request: BrowserInitScriptRequest = { registrationKey: this.regKey, source };
        return invokeUnwrapped(BrowserChannel.addInitScript, request);
    }

    removeInitScript(id: string): Promise<boolean> {
        const request: BrowserInitScriptRemovalRequest = { registrationKey: this.regKey, id };
        return invokeUnwrapped(BrowserChannel.removeInitScript, request);
    }

    clearInitScripts(): Promise<number> {
        const request: BrowserInitScriptTargetRequest = { registrationKey: this.regKey };
        return invokeUnwrapped(BrowserChannel.clearInitScripts, request);
    }

    getStorageStateCookies(urls: string[]): Promise<BrowserCookie[]> {
        const request: BrowserStorageCookiesRequest = { registrationKey: this.regKey, urls };
        return invokeUnwrapped(BrowserChannel.getStorageStateCookies, request);
    }

    setStorageStateCookies(cookies: BrowserCookie[]): Promise<void> {
        const request: BrowserSetStorageCookiesRequest = { registrationKey: this.regKey, cookies };
        return invokeUnwrapped(BrowserChannel.setStorageStateCookies, request);
    }

    addRequestRoute(request: Omit<BrowserRouteRequest, "registrationKey">): Promise<void> {
        return invokeUnwrapped(BrowserChannel.addRequestRoute, { ...request, registrationKey: this.regKey });
    }

    removeRequestRoutes(pattern?: BrowserRouteRemovalRequest["pattern"]): Promise<void> {
        const request: BrowserRouteRemovalRequest = { registrationKey: this.regKey, ...(pattern !== undefined ? { pattern } : {}) };
        return invokeUnwrapped(BrowserChannel.removeRequestRoutes, request);
    }

    /** Send a keyboard event through Electron input when this key resolves to an app or browser target. */
    async sendInputEvent(input: BrowserKeyboardInputEvent): Promise<boolean> {
        return invokeUnwrapped(BrowserChannel.cdpSendInputEvent, this.regKey, input);
    }

    /**
     * Evaluate a JavaScript expression in the page and return the result.
     * Supports async expressions (awaited automatically).
     */
    async evaluate(expression: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
        const result = await this.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (result.exceptionDetails) {
            throw new Error(cdpExceptionMessage(result.exceptionDetails, "Evaluation failed"));
        }
        return result.result?.value;
    }

    armNavigationWait(options: {
        waitUntil: "load" | "domcontentloaded" | "networkidle";
        timeout: number;
        kind: "navigation" | "url";
        adoptInProgress?: boolean;
        urlPattern?: string | { source: string; flags: string };
    }): Promise<string> {
        return invokeUnwrapped(BrowserChannel.armNavigationWait, this.regKey, options);
    }

    awaitNavigationWait(token: string): Promise<NavigationWaitResult> {
        return invokeUnwrapped(BrowserChannel.awaitNavigationWait, token);
    }

    armResponseWait(pattern: string | BrowserResponsePattern, options: BrowserResponseWaitOptions): Promise<string> {
        return invokeUnwrapped(BrowserChannel.armResponseWait, this.regKey, pattern, options);
    }

    awaitResponseWait(token: string): Promise<BrowserResponseResult> {
        return invokeUnwrapped(BrowserChannel.awaitResponseWait, token);
    }

    waitForDownload(options?: BrowserDownloadWaitOptions): Promise<BrowserDownloadResult> {
        const request: BrowserDownloadWaitRequest = { registrationKey: this.regKey, options };
        return invokeUnwrapped(BrowserChannel.waitForDownload, request);
    }
}

/** `ipcRenderer.invoke`, rethrowing without Electron's "Error invoking remote method '…': Error: " framing. */
async function invokeUnwrapped<T>(channel: string, ...args: unknown[]): Promise<T> {
    try {
        return await ipcRenderer.invoke(channel, ...args);
    } catch (error: unknown) {
        throw new Error(errMessage(error).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ""), { cause: error });
    }
}

/**
 * The message of a CDP `exceptionDetails`. An Error's `description` is its whole stack
 * ("Error: msg\n    at <anonymous>:1:5"), which is noise to an agent: keep the first line,
 * and drop a plain `Error: ` prefix (a typed one such as `TypeError: ` stays).
 */
export function cdpExceptionMessage(
    details: { text?: string; exception?: { description?: string } },
    fallback: string,
): string {
    const description = details.exception?.description;
    if (!description) return details.text || fallback;
    const firstLine = description.split("\n")[0];
    return firstLine.startsWith("Error: ") ? firstLine.slice("Error: ".length) : firstLine;
}
