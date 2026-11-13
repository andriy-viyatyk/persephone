const { ipcRenderer } = require("electron"); // eslint-disable-line @typescript-eslint/no-var-requires
import { BrowserChannel, type NetworkLogEntry } from "../../ipc/browser-ipc";
import { callOnRef, getRefSessionId, parseRef } from "./ref";
import { resolveElementLocator } from "./locator";
import { FRAME_OFFSETS_FN, resolveCandidatesSource, VISIBLE_FN } from "./page-scripts";
import { errMessage } from "../../shared/utils";
import type { IAutomationTarget, ITabInfoTarget } from "./types";
import type { RefLocator } from "./locator";


export type ScreenshotFormat = "png" | "jpeg";
export interface ScreenshotOptions {
    tabId?: string; target?: string | RefLocator; fullPage?: boolean; format?: ScreenshotFormat; quality?: number;
    /** Zero-based among visible matches when a `target` selector matches several. */
    nth?: number;
    /** Facade supplied to enforce host-specific capture behavior. */
    host?: "browser" | "board" | "app";
    returnUndefinedIfUnavailable?: boolean;
}
export interface ViewportOptions { tabId?: string; width: number; height: number; deviceScaleFactor?: number }
export interface ScreenshotResult {
    type: "image";
    data: string;
    mimeType: "image/png" | "image/jpeg";
}

export async function takeScreenshot(
    target: IAutomationTarget,
    tabId?: string,
    options: ScreenshotOptions = {},
): Promise<ScreenshotResult | undefined> {
    try {
        const format = options.format ?? "png";
        if (format !== "png" && format !== "jpeg") throw new Error("Screenshot format must be png or jpeg.");
        if (options.quality !== undefined && (format !== "jpeg" || !Number.isInteger(options.quality) || options.quality < 0 || options.quality > 100)) {
            throw new Error("Screenshot quality must be an integer from 0 to 100 and is only valid for jpeg.");
        }
        if (options.target !== undefined && options.fullPage) throw new Error("screenshot target and fullPage are mutually exclusive.");
        if (options.fullPage && options.host !== "browser") throw new Error("fullPage screenshots are not supported on this host");
        const cdp = target.cdp(tabId);
        const params: Record<string, unknown> = { format, ...(options.quality !== undefined ? { quality: options.quality } : {}) };
        if (options.fullPage) {
            const metrics = await cdp.send("Page.getLayoutMetrics");
            const content = metrics.cssContentSize ?? metrics.contentSize;
            if (!content || !(content.width > 0) || !(content.height > 0)) throw new Error("Could not determine the page content size for a fullPage screenshot.");
            params.clip = { x: 0, y: 0, width: content.width, height: content.height, scale: 1 };
            params.captureBeyondViewport = true;
        } else if (options.target !== undefined) {
            const locator = resolveElementLocator(options.target);
            if ("ref" in locator && parseRef(locator.ref).frameIndex !== null) {
                throw new Error("Element screenshots inside a cross-origin iframe are not supported — pass the iframe element's own ref from the parent document");
            }
            const sessionId = "ref" in locator ? getRefSessionId(cdp, locator.ref) : undefined;
            const box = "ref" in locator
                ? await callOnRef(cdp, locator.ref, `function() {
                    const rect = this.getBoundingClientRect();
                    ${FRAME_OFFSETS_FN}
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, frameOffsets };
                }`, true)
                : await cdp.evaluate(`(() => {
                    const force = false; ${resolveCandidatesSource()}
                    // Same strictness as every other action: count visible matches, { nth } picks one.
                    const nth = ${JSON.stringify(options.nth ?? null)};
                    ${VISIBLE_FN}
                    const matches = (${JSON.stringify(locator.selector)}.startsWith('text=') ? resolveCandidates(${JSON.stringify(locator.selector)}, 'query') : [...document.querySelectorAll(${JSON.stringify(locator.selector)})]).filter(visible);
                    if (!matches.length) throw new Error('Screenshot element not found or not visible.');
                    if (matches.length > 1 && nth === null) throw new Error('Ambiguous screenshot selector: ' + matches.length + ' visible matches. Use a ref, narrow the selector, or pass { nth }.');
                    const chosen = matches[nth ?? 0];
                    if (!chosen) throw new Error('No visible match at { nth: ' + nth + ' }.');
                    const rect = chosen.getBoundingClientRect();
                    if (!(rect.width > 0 && rect.height > 0)) throw new Error('Screenshot element is not visible.');
                    ${FRAME_OFFSETS_FN}
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, frameOffsets };
                })()`);
            if (!(box.width > 0 && box.height > 0)) throw new Error("Screenshot element is not visible.");
            const input = target.inputCdp(tabId, sessionId);
            const point = input.mapPoint({ x: box.x, y: box.y }, box.frameOffsets);
            params.clip = { x: point.x, y: point.y, width: box.width, height: box.height, scale: 1 };
        }
        const { data } = await cdp.send("Page.captureScreenshot", params);
        if (!data) return undefined;
        return { type: "image", data, mimeType: format === "jpeg" ? "image/jpeg" : "image/png" };
    } catch (error: unknown) {
        const message = errMessage(error, "Screenshot failed.");
        if (options.returnUndefinedIfUnavailable && /Protocol error|Debugger is not attached|WebContents not found/i.test(message)) return undefined;
        if (options.returnUndefinedIfUnavailable && !/fullPage|Screenshot|screenshot|quality|jpeg|png|cross-origin|mutually exclusive/i.test(message)) return undefined;
        throw error;
    }
}

export async function setViewport(target: IAutomationTarget, options: ViewportOptions): Promise<void> {
    if (!Number.isInteger(options.width) || options.width <= 0 || !Number.isInteger(options.height) || options.height <= 0) {
        throw new Error("Viewport width and height must be positive integers.");
    }
    const scale = options.deviceScaleFactor ?? 1;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("deviceScaleFactor must be a positive finite number.");
    await target.cdp(options.tabId).send("Emulation.setDeviceMetricsOverride", {
        width: options.width, height: options.height, deviceScaleFactor: scale, mobile: false,
    });
}

export async function clearViewport(target: IAutomationTarget, options: { tabId?: string } = {}): Promise<void> {
    await target.cdp(options.tabId).send("Emulation.clearDeviceMetricsOverride");
}

export async function networkRequests(target: IAutomationTarget & ITabInfoTarget, tabId?: string, options: { includeBodies?: boolean; maxBodyBytes?: number } = {}): Promise<NetworkLogEntry[]> {
    const tab = tabId ? target.tabs.find(item => item.id === tabId) : target.activeTab;
    if (!tab) throw new Error(tabId ? `No tab with id "${tabId}"` : "No active tab");
    return ipcRenderer.invoke(BrowserChannel.getNetworkLog, target.cdp(tab.id).registrationKey, options);
}
