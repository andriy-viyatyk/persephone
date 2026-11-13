import type { IWindowScreen } from "./types/window";
import { windowRecording } from "./window-recording";
import type { RecordingRegion } from "../../ipc/api-param-types";
import type {
    IBrowserActionOptions, IBrowserClickOptions, IBrowserConsoleLevel, IBrowserDragOptions,
    IBrowserElementLocator, IBrowserEvaluateFunction, IBrowserEvaluateOptions, IBrowserFormField,
    IBrowserHoverOptions, IBrowserKeyboardOptions, IBrowserNetworkRequest, IBrowserResponse,
    IBrowserResponseWaitOptions, IBrowserScreenshot, IBrowserScreenshotOptions, IBrowserSelectOptions,
    IBrowserTypeOptions,
} from "./types/browser-editor";
import { appTarget } from "../automation/AppTargetModel";
import { clickAtCoordinates, dragCoordinates } from "../automation/mouse";
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
        return this.automation.runHostOperation("clickAt", undefined, () => clickAtCoordinates(appTarget, position), { passive: false, tip: false });
    }
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
    waitFor(options: WaitForOption): Promise<void> { return this.automation.waitFor(options); }
    screenshot(options?: IBrowserScreenshotOptions): Promise<IBrowserScreenshot | undefined> { return this.automation.screenshot(options); }
    drag(source: IBrowserElementLocator, destination: IBrowserElementLocator, options?: IBrowserDragOptions): Promise<void> { return this.automation.drag(source, destination, options); }
    dragTo(options: { from: { x: number; y: number }; to: { x: number; y: number } }): Promise<void> {
        return this.automation.runHostOperation("dragTo", undefined, () => dragCoordinates(appTarget, options.from, options.to), { passive: false, tip: false });
    }
    fillForm(fields: IBrowserFormField[]): Promise<void> { return this.automation.fillForm(fields); }
    setInputFiles(locator: IBrowserElementLocator, paths: string[], options?: TabOption): Promise<void> { return this.automation.setInputFiles(locator, paths, options); }
    networkRequests(options?: TabOption): Promise<IBrowserNetworkRequest[]> { return this.automation.networkRequests(options); }
    waitForResponse(urlOrRegex: string | RegExp, options?: IBrowserResponseWaitOptions): Promise<IBrowserResponse> { return this.automation.waitForResponse(urlOrRegex, options); }
    consoleMessages(options?: TabOption & { since?: number; level?: IBrowserConsoleLevel }) { return this.automation.consoleMessages(options); }
    pageErrors(options?: TabOption) { return this.automation.pageErrors(options); }
}
