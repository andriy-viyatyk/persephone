import { agentMayAccessBrowserPage, privateBrowserRefusal } from "./agent-access";
import type { BrowserEditor } from "./BrowserEditor";

/** Owns the deliberately ephemeral grant used by browser-test runner calls. */
export class BrowserTestPowerAdoption {
    constructor(private readonly model: BrowserEditor) {}

    adopt(): void {
        const state = this.model.state.get();
        if (!agentMayAccessBrowserPage(state)) throw new Error(privateBrowserRefusal(state));
        this.model.state.update((current) => { current.testPowerAdopted = true; });
    }

    release(): void {
        this.model.state.update((state) => { state.testPowerAdopted = false; });
    }
}
