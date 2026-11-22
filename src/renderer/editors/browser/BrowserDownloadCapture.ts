import type { BrowserDownloadResult, BrowserDownloadWaitOptions } from "../../../ipc/browser-ipc";
import { agentMayUseBrowserTestPower, BROWSER_TEST_POWER_REFUSAL } from "./agent-access";
import type { BrowserEditor } from "./BrowserEditor";

/** Starts a main-process download wait for one selected browser tab. */
export class BrowserDownloadCapture {
    constructor(private readonly model: BrowserEditor) {}

    wait(options?: BrowserDownloadWaitOptions): Promise<BrowserDownloadResult> {
        if (!agentMayUseBrowserTestPower(this.model.state.get())) throw new Error(BROWSER_TEST_POWER_REFUSAL);
        if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options)
            || (options.timeout !== undefined && (typeof options.timeout !== "number" || !Number.isFinite(options.timeout) || options.timeout <= 0)))) {
            throw new TypeError("waitForDownload timeout must be a positive finite number.");
        }
        const tabId = this.model.state.get().activeTabId;
        if (!tabId) throw new Error("No active browser tab.");
        this.model.target.assertTabId(tabId, "waitForDownload()");
        return this.model.target.ensureReady(tabId).then(() => {
            if (!agentMayUseBrowserTestPower(this.model.state.get())) throw new Error(BROWSER_TEST_POWER_REFUSAL);
            return this.model.target.cdp(tabId).waitForDownload(options);
        });
    }
}
