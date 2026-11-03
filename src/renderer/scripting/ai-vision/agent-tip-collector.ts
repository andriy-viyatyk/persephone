import { settings } from "../../api/settings";
import { siteExtensionStore } from "../../api/site-extensions";

export interface TipObservation {
    action: string;
    hostname: string;
    page: string;
    interaction: boolean;
    enabled: boolean;
    eligible: boolean;
}

const INTERACTIONS = new Set(["click", "type", "select", "check", "uncheck", "clear", "fillForm", "pressKey", "drag", "setInputFiles"]);

/** A collector belongs to one forwarded MCP call, never a renderer or script global. */
export class AgentTipCollector {
    private closed = false;
    private readonly pending: Promise<TipObservation | undefined>[] = [];

    record(url: string | undefined, action: string): void {
        if (this.closed || !url) return;
        this.pending.push(this.inspect(url, action));
    }

    private async inspect(url: string, action: string): Promise<TipObservation | undefined> {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== "https:" || !parsed.hostname) return undefined;
            const enabled = settings.get("agent-tips.enabled") === true;
            if (!enabled) return undefined;
            const [extension, listings] = await Promise.all([
                siteExtensionStore.findForHost(parsed.hostname), siteExtensionStore.list(),
            ]);
            if (settings.get("agent-tips.enabled") !== true) return undefined;
            return {
                action, hostname: parsed.hostname, page: parsed.pathname + parsed.search,
                interaction: INTERACTIONS.has(action), enabled,
                eligible: !extension && !listings.some(item => item.status === "conflict" && item.conflictingHosts.includes(parsed.hostname)),
            };
        } catch { return undefined; }
    }

    async finish(): Promise<TipObservation[]> {
        this.closed = true;
        const results = await Promise.all(this.pending);
        return results.filter((item): item is TipObservation => item !== undefined);
    }

    discard(): void { this.closed = true; this.pending.length = 0; }
}
