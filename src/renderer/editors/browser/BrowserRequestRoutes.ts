import type { BrowserRouteAction, BrowserRouteOptions, BrowserRoutePattern } from "../../../ipc/browser-ipc";
import { toWirePattern, type UrlPatternInput } from "../../automation/navigation";
import type { BrowserEditor } from "./BrowserEditor";

/** Request-scoped facade collaborator for declarative page routes. */
export class BrowserRequestRoutes {
    constructor(private readonly model: BrowserEditor) {}

    async add(pattern: UrlPatternInput, response: BrowserRouteAction, options?: BrowserRouteOptions, tabId?: string): Promise<void> {
        const selectedTabId = this.selectedTab(tabId, "route()");
        validateOptions(options);
        validateAction(response);
        const wirePattern: BrowserRoutePattern = toWirePattern(pattern, "route");
        await this.model.target.ensureReady(selectedTabId);
        await this.model.target.cdp(selectedTabId).addRequestRoute({ pattern: wirePattern, response, options });
    }

    async remove(pattern?: UrlPatternInput, tabId?: string): Promise<void> {
        const selectedTabId = this.selectedTab(tabId, "unroute()");
        const wirePattern = pattern === undefined ? undefined : toWirePattern(pattern, "unroute");
        await this.model.target.ensureReady(selectedTabId);
        await this.model.target.cdp(selectedTabId).removeRequestRoutes(wirePattern);
    }

    private selectedTab(tabId: string | undefined, method: string): string {
        const selectedTabId = tabId ?? this.model.state.get().activeTabId;
        if (!selectedTabId) throw new Error("No active browser tab.");
        this.model.target.assertTabId(selectedTabId, method);
        return selectedTabId;
    }
}

function validateOptions(options: BrowserRouteOptions | undefined): void {
    if (options === undefined) return;
    if (!options || typeof options !== "object" || Array.isArray(options)
        || Object.keys(options).some((key) => !["times", "method", "resourceTypes"].includes(key))) {
        throw new TypeError("Route options must contain only times, method, or resourceTypes.");
    }
}

function validateAction(response: BrowserRouteAction): void {
    if (typeof response === "function") throw new TypeError("Browser routes accept declarative JSON responses, not handler functions.");
    if (response === "abort") return;
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new TypeError("A route response must be an object or 'abort'.");
    for (const value of Object.values(response)) {
        if (typeof value === "function") throw new TypeError("Browser route responses must be JSON-only.");
    }
}
