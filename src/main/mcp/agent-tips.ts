/** Private, bounded observations owned by one MCP transport. */
export interface AgentTipObservation {
    action: string;
    hostname: string;
    page: string;
    interaction: boolean;
    enabled: boolean;
    eligible: boolean;
}

export interface AgentTip { id: string; text: string }

// Product tuning: count distinct pages before suggesting an extension.
const MIN_DISTINCT_PAGE_URLS = 5;

interface TipDefinition {
    id: string;
    trigger: (observation: AgentTipObservation, host: { pages: Set<string>; interaction: boolean }, guideRead: boolean) => boolean;
    text: (hostname: string) => string;
}

const TIPS: readonly TipDefinition[] = [{
    id: "site-extension",
    trigger: (observation, host, guideRead) => observation.eligible && host.interaction
        && host.pages.size >= MIN_DISTINCT_PAGE_URLS && !guideRead,
    text: hostname => `Optional suggestion: you have automated several pages of ${hostname}. After finishing the current task, ask the user in one sentence whether this is recurring work; if so, offer to build a site extension for it (read guides.agents["site-extensions"] first).`,
}];

export class AgentTipsRegistry {
    private readonly delivered = new Set<string>();
    private readonly hosts = new Map<string, { pages: Set<string>; interaction: boolean }>();
    private guideRead = false;
    private disposed = false;

    markGuideRead(): void { if (!this.disposed) this.guideRead = true; }

    observe(observations: readonly AgentTipObservation[]): AgentTip | undefined {
        if (this.disposed) return undefined;
        for (const observation of observations) {
            if (!observation.enabled) continue;
            let host = this.hosts.get(observation.hostname);
            if (!host) {
                host = { pages: new Set(), interaction: false };
                this.hosts.set(observation.hostname, host);
            }
            if (host.pages.size < MIN_DISTINCT_PAGE_URLS) host.pages.add(observation.page);
            host.interaction ||= observation.interaction;
            for (const tip of TIPS) {
                if (!this.delivered.has(tip.id) && tip.trigger(observation, host, this.guideRead)) {
                    this.delivered.add(tip.id);
                    return { id: tip.id, text: tip.text(observation.hostname) };
                }
            }
        }
        return undefined;
    }

    dispose(): void {
        this.disposed = true;
        this.hosts.clear();
        this.delivered.clear();
    }
}
