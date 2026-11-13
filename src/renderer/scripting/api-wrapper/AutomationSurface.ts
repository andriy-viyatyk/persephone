import type {
    IBrowserActionOptions, IBrowserClickOptions, IBrowserConsoleLevel, IBrowserDragOptions,
    IBrowserElementLocator, IBrowserEvaluateFunction, IBrowserEvaluateOptions, IBrowserFormField,
    IBrowserHoverOptions, IBrowserKeyboardOptions, IBrowserNetworkRequest, IBrowserNetworkRequestsOptions,
    IBrowserResponse, IBrowserResponseWaitOptions, IBrowserScreenshot, IBrowserScreenshotOptions,
    IBrowserSelectOptions, IBrowserTypeOptions,
} from "../../api/types/browser-editor";
import { clickElement, checkElement, hoverElement, dragElements, uncheckElement } from "../../automation/mouse";
import { keyDownOnTarget, keyUpOnTarget, pressKeyOnTarget } from "../../automation/keyboard";
import { clearElement, typeTextInto, selectOption, fillForm, setInputFiles } from "../../automation/forms";
import { evaluateInTarget, waitFor, type WaitMode } from "../../automation/queries";
import {
    dialogs, handlePageDialog, consoleMessages, pageErrors, setDialogPolicy, snapshot,
    ensureTargetReady, withAutomationActivity,
} from "../../automation/page-events";
import { networkRequests, takeScreenshot } from "../../automation/page-state";
import { waitForResponse } from "../../automation/navigation";
import { resolveElementLocator } from "../../automation/locator";
import type { IAutomationTarget, ISyntheticInputHost, ITabInfoTarget } from "../../automation/types";
import type { PageDialogPolicy } from "../../../ipc/browser-ipc";

type SurfaceHost = "browser" | "board" | "app";

interface AutomationSurfaceOptions {
    target: IAutomationTarget & ISyntheticInputHost & Partial<ITabInfoTarget>;
    host: SurfaceHost;
    tipUrl?: (tabId?: string) => string | undefined;
    recordTip?: (url: string | undefined, operation: string) => void;
}

interface WaitForOption {
    selector?: string;
    state?: "attached" | "detached" | "visible" | "hidden";
    text?: string;
    textGone?: string;
    time?: number;
    timeout?: number;
    tabId?: string;
}

/** Shared script-facing automation adapter for browser-like hosts. */
export class AutomationSurface {
    constructor(private readonly options: AutomationSurfaceOptions) {}

    private get target(): IAutomationTarget & ISyntheticInputHost & Partial<ITabInfoTarget> { return this.options.target; }

    private async run<T>(
        operation: string,
        tabId: string | undefined,
        fn: () => T | Promise<T>,
        options: {
            passive: boolean;
            policyChange?: boolean;
            tip?: boolean;
            tipTabId?: string;
            useTipTabId?: boolean;
            readinessTabs?: Array<string | undefined>;
        },
    ): Promise<T> {
        const tabs = options.readinessTabs ?? [tabId];
        for (const id of new Set(tabs)) await ensureTargetReady(this.target, id);
        const invoke = async (): Promise<T> => {
            const tipUrl = options.tip ? this.options.tipUrl?.(options.useTipTabId ? options.tipTabId : tabId) : undefined;
            const result = await fn();
            if (options.tip) this.options.recordTip?.(tipUrl, operation);
            return result;
        };
        return options.passive || options.policyChange
            ? invoke()
            : withAutomationActivity(this.target, tabId, invoke);
    }

    runHostOperation<T>(
        operation: string,
        tabId: string | undefined,
        fn: () => T | Promise<T>,
        options: { passive: boolean; tip: boolean },
    ): Promise<T> {
        return this.run(operation, tabId, fn, options);
    }

    snapshot(options?: { tabId?: string; root?: string | { ref: string }; interactive?: boolean; maxNodes?: number; maxChars?: number }): Promise<string> {
        return this.run("snapshot", options?.tabId,
            () => snapshot(this.target, options?.tabId, { ...options, overlayHint: true, host: this.options.host }),
            { passive: false, tip: true });
    }
    click(locator: IBrowserElementLocator, options?: IBrowserClickOptions): Promise<void> {
        return this.run("click", options?.tabId, () => clickElement(this.target, resolveElementLocator(locator), options), { passive: false, tip: true });
    }
    hover(locator: IBrowserElementLocator, options?: IBrowserHoverOptions): Promise<void> {
        return this.run("hover", options?.tabId, () => hoverElement(this.target, resolveElementLocator(locator), options), { passive: false });
    }
    type(locator: IBrowserElementLocator, text: string, options?: IBrowserTypeOptions): Promise<void> {
        return this.run("type", options?.tabId, () => typeTextInto(this.target, resolveElementLocator(locator), text, options), { passive: false, tip: true });
    }
    select(locator: IBrowserElementLocator, values: string | string[], options?: IBrowserSelectOptions): Promise<void> {
        return this.run("select", options?.tabId, () => selectOption(this.target, resolveElementLocator(locator), values, options), { passive: false, tip: true });
    }
    check(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> {
        return this.run("check", options?.tabId, () => checkElement(this.target, resolveElementLocator(locator), options), { passive: false, tip: true });
    }
    uncheck(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> {
        return this.run("uncheck", options?.tabId, () => uncheckElement(this.target, resolveElementLocator(locator), options), { passive: false, tip: true });
    }
    clear(locator: IBrowserElementLocator, options?: IBrowserTypeOptions): Promise<void> {
        return this.run("clear", options?.tabId, () => clearElement(this.target, resolveElementLocator(locator), options), { passive: false, tip: true });
    }
    pressKey(key: string, options?: IBrowserKeyboardOptions): Promise<void> {
        return this.run("pressKey", options?.tabId, () => pressKeyOnTarget(this.target, key, options), { passive: false, tip: true });
    }
    keyDown(key: string, options?: IBrowserKeyboardOptions): Promise<void> {
        return this.run("keyDown", options?.tabId, () => keyDownOnTarget(this.target, key, options), { passive: false });
    }
    keyUp(key: string, options?: IBrowserKeyboardOptions): Promise<void> {
        return this.run("keyUp", options?.tabId, () => keyUpOnTarget(this.target, key, options), { passive: false });
    }
    drag(source: IBrowserElementLocator, destination: IBrowserElementLocator, options?: IBrowserDragOptions): Promise<void> {
        return this.run("drag", options?.tabId, () => dragElements(this.target, resolveElementLocator(source), resolveElementLocator(destination), options), { passive: false, tip: true });
    }
    fillForm(fields: IBrowserFormField[]): Promise<void> {
        const active = this.target.activeTab?.id;
        const readinessTabs = this.options.host === "browser"
            ? [
                ...fields.map(field => field.options?.tabId || active),
                ...(fields.some(field => field.options?.tabId === undefined) ? [undefined] : []),
            ]
            : fields.map(field => field.options?.tabId);
        const leaseTab = fields.find(field => typeof field.options?.tabId === "string")?.options?.tabId;
        const tipTab = new Set(readinessTabs).size === 1 ? readinessTabs[0] : undefined;
        return this.run("fillForm", leaseTab, () => fillForm(this.target, fields), {
            passive: false, tip: true, tipTabId: tipTab, useTipTabId: true,
            readinessTabs: readinessTabs.length ? readinessTabs : [undefined],
        });
    }
    setInputFiles(locator: IBrowserElementLocator, paths: string[], options?: { tabId?: string }): Promise<void> {
        return this.run("setInputFiles", options?.tabId, () => setInputFiles(this.target, resolveElementLocator(locator), paths, options), { passive: false, tip: true });
    }
    evaluate(expression: string | IBrowserEvaluateFunction, options?: IBrowserEvaluateOptions): Promise<unknown> {
        return this.run("evaluate", options?.tabId, () => evaluateInTarget(this.target, expression, options), { passive: false, tip: true });
    }
    waitFor(options: WaitForOption): Promise<void> {
        if (options.state !== undefined && options.selector === undefined) throw new Error("'state' can only be used with 'selector'.");
        const modes = [options.selector, options.text, options.textGone, options.time].filter(value => value !== undefined);
        if (modes.length !== 1) throw new Error("Expected exactly one of 'selector', 'text', 'textGone', or 'time'.");
        let mode: WaitMode;
        if (options.time !== undefined) mode = { kind: "time", seconds: options.time };
        else if (options.selector !== undefined) mode = { kind: "selector", selector: options.selector, state: options.state ?? "attached" };
        else if (options.text !== undefined) mode = { kind: "text", text: options.text };
        else mode = { kind: "textGone", text: options.textGone! };
        return this.run("waitFor", options.tabId, () => waitFor(this.target, { mode, timeout: options.timeout, tabId: options.tabId }), { passive: false });
    }
    screenshot(options?: IBrowserScreenshotOptions): Promise<IBrowserScreenshot | undefined> {
        return this.run("screenshot", options?.tabId, () => takeScreenshot(this.target, options?.tabId, {
            ...options, host: this.options.host, returnUndefinedIfUnavailable: true,
        }), { passive: false });
    }
    networkRequests(options?: IBrowserNetworkRequestsOptions): Promise<IBrowserNetworkRequest[]> {
        return this.run("networkRequests", options?.tabId, () => networkRequests(this.target as IAutomationTarget & ITabInfoTarget,
            options?.tabId, this.options.host === "browser" ? options : undefined), { passive: true });
    }
    waitForResponse(urlOrRegex: string | RegExp, options?: IBrowserResponseWaitOptions): Promise<IBrowserResponse> {
        return this.run("waitForResponse", options?.tabId, () => waitForResponse(this.target, urlOrRegex, options), { passive: false });
    }
    consoleMessages(options?: { tabId?: string; since?: number; level?: IBrowserConsoleLevel }) {
        return this.run("consoleMessages", options?.tabId, () => consoleMessages(this.target, options), { passive: true });
    }
    pageErrors(options?: { tabId?: string }) {
        return this.run("pageErrors", options?.tabId, () => pageErrors(this.target, options?.tabId), { passive: true });
    }
    dialogs(options?: { tabId?: string; policy?: PageDialogPolicy }) {
        const isPolicyChange = options?.policy === "accept" || options?.policy === "dismiss" || options?.policy === "manual";
        return this.run("dialogs", options?.tabId, async () => {
            if (options?.policy !== undefined) await setDialogPolicy(this.target, options.policy, options.tabId);
            return dialogs(this.target, options?.tabId);
        }, { passive: true, policyChange: isPolicyChange });
    }
    handleDialog(accept: boolean, promptText?: string, options?: { tabId?: string }): Promise<void> {
        return this.run("handleDialog", options?.tabId, () => handlePageDialog(this.target, accept, promptText, options?.tabId), { passive: true });
    }
}
