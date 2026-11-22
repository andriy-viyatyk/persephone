import type { IWindowScreen } from "./types/window";
import { windowRecording } from "./window-recording";
import type { RecordingRegion } from "../../ipc/api-param-types";
import type {
    IBrowserActionOptions, IBrowserClickOptions, IBrowserConsoleLevel, IBrowserDragOptions,
    IBrowserDragDestination, IBrowserElementLocator, IBrowserEvaluateFunction, IBrowserEvaluateOptions, IBrowserFormField,
    IBrowserHoverOptions, IBrowserKeyboardOptions, IBrowserNetworkRequest, IBrowserResponse,
    IBrowserResponseWaitOptions, IBrowserScreenshot, IBrowserScreenshotOptions, IBrowserSelectOptions,
    IBrowserTypeOptions,
    IBrowserPointerTarget, IBrowserPointerOptions, IBrowserMouseMoveOptions, IBrowserWheelOptions, IBrowserWheelDelta,
    IBrowserLocatorReadOptions, IBrowserQueryOptions, IBrowserQueryResult, IBrowserWaitForFunctionOptions, IBrowserJsonValue,
} from "./types/browser-editor";
import { appTarget } from "../automation/AppTargetModel";
import { clickAtCoordinates, dragCoordinates, mouseDown as mouseDownOperation, mouseMove as mouseMoveOperation, mouseUp as mouseUpOperation, wheel as wheelOperation } from "../automation/mouse";
import type { UrlPatternInput } from "../automation/navigation";
import { AutomationSurface } from "../scripting/api-wrapper/AutomationSurface";

interface TabOption { tabId?: string }
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
    private readonly automation = new AutomationSurface({ target: appTarget, host: "app" });
    readonly recording = {
        start: (options: { region: RecordingRegion; openPlayer?: boolean; hideStatusChrome?: boolean }) => windowRecording.start(options.region, options),
        pause: () => windowRecording.pause(),
        resume: () => windowRecording.resume(),
        stop: () => windowRecording.stop("agent"),
        cancel: () => windowRecording.cancel(),
        get state() { return windowRecording.state; },
    };

    snapshot(options?: TabOption & { root?: string | { ref: string }; interactive?: boolean; maxNodes?: number; maxChars?: number }): Promise<string> {
        return this.automation.snapshot(options);
    }
    click(locator: IBrowserElementLocator, options?: IBrowserClickOptions): Promise<void> { return this.automation.click(locator, options); }
    clickAt(position: { x: number; y: number }): Promise<void> {
        return this.automation.runHostOperation("clickAt", undefined, () => clickAtCoordinates(appTarget, position, {}, { focusHost: false }), { passive: false, tip: false });
    }
    mouseDown(target: IBrowserPointerTarget, options?: IBrowserPointerOptions): Promise<void> {
        return this.automation.runHostOperation("mouseDown", undefined, () => mouseDownOperation(appTarget, target, options), { passive: false, tip: false });
    }
    mouseMove(target: IBrowserPointerTarget, options?: IBrowserMouseMoveOptions): Promise<void> {
        return this.automation.runHostOperation("mouseMove", undefined, () => mouseMoveOperation(appTarget, target, options), { passive: false, tip: false });
    }
    mouseUp(target?: IBrowserPointerTarget, options?: IBrowserPointerOptions): Promise<void> {
        return this.automation.runHostOperation("mouseUp", undefined, () => mouseUpOperation(appTarget, target, options), { passive: false, tip: false });
    }
    wheel(delta: IBrowserWheelDelta, target?: IBrowserPointerTarget, options?: IBrowserWheelOptions): Promise<void> {
        return this.automation.runHostOperation("wheel", undefined, () => wheelOperation(appTarget, delta, target, options), { passive: false, tip: false });
    }
    focus(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> { return this.automation.focus(locator, options); }
    hover(locator: IBrowserElementLocator, options?: IBrowserHoverOptions): Promise<void> { return this.automation.hover(locator, options); }
    type(locator: IBrowserElementLocator, text: string, options?: IBrowserTypeOptions): Promise<void> { return this.automation.type(locator, text, options); }
    select(locator: IBrowserElementLocator, values: string | string[], options?: IBrowserSelectOptions): Promise<void> { return this.automation.select(locator, values, options); }
    check(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> { return this.automation.check(locator, options); }
    uncheck(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void> { return this.automation.uncheck(locator, options); }
    clear(locator: IBrowserElementLocator, options?: IBrowserTypeOptions): Promise<void> { return this.automation.clear(locator, options); }
    pressKey(key: string, options?: IBrowserKeyboardOptions): Promise<void> { return this.automation.pressKey(key, options); }
    keyDown(key: string, options?: IBrowserKeyboardOptions): Promise<void> { return this.automation.keyDown(key, options); }
    keyUp(key: string, options?: IBrowserKeyboardOptions): Promise<void> { return this.automation.keyUp(key, options); }
    evaluate(expression: string | IBrowserEvaluateFunction, options?: IBrowserEvaluateOptions): Promise<unknown> { return this.automation.evaluate(expression, options); }
    count(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<number> { return this.automation.count(locator, options); }
    isVisible(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<boolean> { return this.automation.isVisible(locator, options); }
    isEnabled(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<boolean> { return this.automation.isEnabled(locator, options); }
    isChecked(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<boolean> { return this.automation.isChecked(locator, options); }
    innerText(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<string> { return this.automation.innerText(locator, options); }
    allInnerTexts(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<string[]> { return this.automation.allInnerTexts(locator, options); }
    boundingBox(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<{ x: number; y: number; width: number; height: number } | null> { return this.automation.boundingBox(locator, options); }
    query(locator: IBrowserElementLocator, options?: IBrowserQueryOptions): Promise<IBrowserQueryResult> { return this.automation.query(locator, options); }
    waitForFunction(fn: string | IBrowserEvaluateFunction, options?: IBrowserWaitForFunctionOptions): Promise<IBrowserJsonValue> { return this.automation.waitForFunction(fn, options); }
    waitFor(options: WaitForOption): Promise<void> { return this.automation.waitFor(options); }
    screenshot(options?: IBrowserScreenshotOptions): Promise<IBrowserScreenshot | undefined> { return this.automation.screenshot(options); }
    drag(source: IBrowserElementLocator, destination: IBrowserDragDestination, options?: IBrowserDragOptions): Promise<void> { return this.automation.drag(source, destination, options); }
    dragTo(options: { from: { x: number; y: number }; to: { x: number; y: number } }, timing?: { steps?: number; holdMs?: number }): Promise<void> {
        return this.automation.runHostOperation("dragTo", undefined, () => dragCoordinates(appTarget, options.from, options.to, timing, { validateCoordinates: false, focusHost: false }), { passive: false, tip: false });
    }
    fillForm(fields: IBrowserFormField[]): Promise<void> { return this.automation.fillForm(fields); }
    setInputFiles(locator: IBrowserElementLocator, paths: string[], options?: TabOption): Promise<void> { return this.automation.setInputFiles(locator, paths, options); }
    networkRequests(options?: TabOption): Promise<IBrowserNetworkRequest[]> { return this.automation.networkRequests(options); }
    waitForResponse(urlOrRegex: UrlPatternInput, options?: IBrowserResponseWaitOptions): Promise<IBrowserResponse> { return this.automation.waitForResponse(urlOrRegex, options); }
    consoleMessages(options?: TabOption & { since?: number; level?: IBrowserConsoleLevel }) { return this.automation.consoleMessages(options); }
    pageErrors(options?: TabOption) { return this.automation.pageErrors(options); }
}
