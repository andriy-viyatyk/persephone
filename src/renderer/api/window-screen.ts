import type { IWindowScreen } from "./types/window";
import { windowRecording } from "./window-recording";
import type { RecordingRegion } from "../../ipc/api-param-types";
import type {
    IBrowserClickOptions,
    IBrowserElementLocator,
    IBrowserHoverOptions,
    IBrowserActionOptions,
    IBrowserKeyboardOptions,
    IBrowserNetworkRequest,
    IBrowserResponse,
    IBrowserResponseWaitOptions,
    IBrowserScreenshot,
    IBrowserSelectOptions,
    IBrowserTypeOptions,
    IBrowserConsoleLevel,
    IBrowserEvaluateOptions,
    IBrowserEvaluateFunction,
    IBrowserDragOptions,
    IBrowserFormField,
    IBrowserScreenshotOptions,
} from "./types/browser-editor";
import { appTarget } from "../automation/AppTargetModel";
import {
    clickElement,
    checkElement,
    clearElement,
    ensureTargetReady,
    evaluateInTarget,
    hoverElement,
    keyDownOnTarget,
    keyUpOnTarget,
    networkRequests,
    consoleMessages,
    pageErrors,
    installAutomationActivity,
    pressKeyOnTarget,
    resolveElementLocator,
    selectOption,
    snapshot,
    takeScreenshot,
    typeTextInto,
    uncheckElement,
    waitFor,
    dragElements,
    fillForm as fillFormOperation,
    setInputFiles as setInputFilesOperation,
    waitForResponse as waitForResponseOperation,
} from "../automation/operations";
import type { WaitMode } from "../automation/operations";

interface TabOption {
    tabId?: string;
}

interface WaitForOption extends TabOption {
    selector?: string;
    state?: "attached" | "detached" | "visible" | "hidden";
    text?: string;
    textGone?: string;
    time?: number;
    timeout?: number;
}

/** Thin Object Model adapter over the existing app-window automation target. */
export class WindowScreen implements IWindowScreen {
    readonly recording = {
        start: (options: { region: RecordingRegion; openPlayer?: boolean }) => windowRecording.start(options.region, options),
        pause: () => windowRecording.pause(),
        resume: () => windowRecording.resume(),
        stop: () => windowRecording.stop("agent"),
        cancel: () => windowRecording.cancel(),
        get state() { return windowRecording.state; },
    };
    async snapshot(options?: TabOption & {
        root?: string | { ref: string };
        interactive?: boolean;
        maxNodes?: number;
        maxChars?: number;
    }): Promise<string> {
        await ensureTargetReady(appTarget, options?.tabId);
        return snapshot(appTarget, options?.tabId, { ...options, overlayHint: true, host: "app" });
    }

    async click(locator: IBrowserElementLocator, options?: IBrowserClickOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await clickElement(appTarget, resolveElementLocator(locator), options);
    }

    async hover(locator: IBrowserElementLocator, options?: IBrowserHoverOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await hoverElement(appTarget, resolveElementLocator(locator), options);
    }

    async type(locator: IBrowserElementLocator, text: string, options?: IBrowserTypeOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await typeTextInto(appTarget, resolveElementLocator(locator), text, {
            tabId: options?.tabId,
            slowly: options?.slowly,
            submit: options?.submit,
            synthetic: options?.synthetic,
            nth: options?.nth,
            timeout: options?.timeout,
            force: options?.force,
        });
    }

    async select(locator: IBrowserElementLocator, values: string | string[], options?: IBrowserSelectOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await selectOption(appTarget, resolveElementLocator(locator), values, options);
    }

    async check(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await checkElement(appTarget, resolveElementLocator(locator), options);
    }

    async uncheck(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await uncheckElement(appTarget, resolveElementLocator(locator), options);
    }

    async clear(locator: IBrowserElementLocator, options?: IBrowserTypeOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await clearElement(appTarget, resolveElementLocator(locator), options);
    }

    async pressKey(key: string, options?: IBrowserKeyboardOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await pressKeyOnTarget(appTarget, key, options);
    }

    async keyDown(key: string, options?: IBrowserKeyboardOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await keyDownOnTarget(appTarget, key, options);
    }

    async keyUp(key: string, options?: IBrowserKeyboardOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await keyUpOnTarget(appTarget, key, options);
    }

    async evaluate(expression: string | IBrowserEvaluateFunction, options?: IBrowserEvaluateOptions): Promise<unknown> {
        await ensureTargetReady(appTarget, options?.tabId);
        return evaluateInTarget(appTarget, expression, options);
    }

    async waitFor(options: WaitForOption): Promise<void> {
        if (options.state !== undefined && options.selector === undefined) {
            throw new Error("'state' can only be used with 'selector'.");
        }
        const modes = [options.selector, options.text, options.textGone, options.time]
            .filter(value => value !== undefined);
        if (modes.length !== 1) {
            throw new Error("Expected exactly one of 'selector', 'text', 'textGone', or 'time'.");
        }
        let mode: WaitMode;
        if (options.time !== undefined) {
            mode = { kind: "time", seconds: options.time };
        } else if (options.selector !== undefined) {
            mode = { kind: "selector", selector: options.selector, state: options.state ?? "attached" };
        } else if (options.text !== undefined) {
            mode = { kind: "text", text: options.text };
        } else {
            mode = { kind: "textGone", text: options.textGone! };
        }
        await ensureTargetReady(appTarget, options.tabId);
        await waitFor(appTarget, { mode, timeout: options.timeout, tabId: options.tabId });
    }

    async screenshot(options?: IBrowserScreenshotOptions): Promise<IBrowserScreenshot | undefined> {
        await ensureTargetReady(appTarget, options?.tabId);
        return takeScreenshot(appTarget, options?.tabId, { ...options, host: "app", returnUndefinedIfUnavailable: true });
    }

    async drag(source: IBrowserElementLocator, destination: IBrowserElementLocator, options?: IBrowserDragOptions): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await dragElements(appTarget, resolveElementLocator(source), resolveElementLocator(destination), options);
    }

    async fillForm(fields: IBrowserFormField[]): Promise<void> {
        await ensureTargetReady(appTarget, fields.find(field => field.options?.tabId)?.options?.tabId);
        await fillFormOperation(appTarget, fields);
    }

    async setInputFiles(locator: IBrowserElementLocator, paths: string[], options?: TabOption): Promise<void> {
        await ensureTargetReady(appTarget, options?.tabId);
        await setInputFilesOperation(appTarget, resolveElementLocator(locator), paths, options);
    }

    async networkRequests(options?: TabOption): Promise<IBrowserNetworkRequest[]> {
        await ensureTargetReady(appTarget, options?.tabId);
        return networkRequests(appTarget, options?.tabId);
    }

    waitForResponse(urlOrRegex: string | RegExp, options?: IBrowserResponseWaitOptions): Promise<IBrowserResponse> {
        return waitForResponseOperation(appTarget, urlOrRegex, options);
    }

    async consoleMessages(options?: TabOption & { since?: number; level?: IBrowserConsoleLevel }) {
        await ensureTargetReady(appTarget, options?.tabId);
        return consoleMessages(appTarget, options);
    }

    async pageErrors(options?: TabOption) {
        await ensureTargetReady(appTarget, options?.tabId);
        return pageErrors(appTarget, options?.tabId);
    }
}

installAutomationActivity(WindowScreen.prototype, [
    "snapshot", "click", "hover", "type", "select", "check", "uncheck", "clear", "pressKey", "keyDown", "keyUp",
    "evaluate", "waitFor", "screenshot", "networkRequests", "waitForResponse", "consoleMessages", "pageErrors", "drag", "fillForm", "setInputFiles",
], () => appTarget);
