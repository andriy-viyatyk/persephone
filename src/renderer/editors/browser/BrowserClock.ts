import type { IAiMember, IAiVisionDescriptor, IAiVisible } from "ai-vision";
import { agentMayAccessBrowserPage, privateBrowserRefusal } from "./agent-access";
import type { BrowserEditor } from "./BrowserEditor";
import { buildBrowserClockSource } from "./browser-clock-script";

interface ClockRegistration {
    id: string;
    initialTime: number;
}

interface ClockRegistry {
    tabs: Map<string, ClockRegistration>;
    unsubscribe: () => void;
}

export interface BrowserClockInstallOptions {
    now?: Date | number | string;
}

const registries = new WeakMap<BrowserEditor, ClockRegistry>();
const members: readonly IAiMember[] = [
    { name: "install", kind: "method", signature: "install(options?: { now?: Date | number | string }): Promise<void>", summary: "Install fake page time now and before future documents start." },
    { name: "fastForward", kind: "method", signature: "fastForward(ms: number): Promise<void>", summary: "Advance page time and run callbacks that become due." },
    { name: "uninstall", kind: "method", signature: "uninstall(): Promise<void>", summary: "Restore page globals, cancel fake timers, and remove future-document installation." },
];

const help = "Install before navigation when application startup must use fake time: open about:blank, call install(), then navigateAndWait(). The fake covers Date, Date.now, performance.now, timeout/interval and animation-frame callbacks; queueMicrotask remains native. Time advances with real elapsed time and fastForward(ms). Installing after load affects future global lookups, but does not migrate existing timers or references captured before installation. Each covered same-process frame has an independent clock; host controls affect the main frame only. Call uninstall() to restore current-document globals and remove future installation. Workers, OOPIFs, network timing, and painting are not controlled.";

export class BrowserClock implements IAiVisible {
    constructor(private readonly model: BrowserEditor) {}

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "BrowserClock",
            summary: "Page-scoped fake time and timer controls.",
            members,
            help,
            summarize: () => ({ kind: "BrowserClock" }),
        };
    }

    async install(options: BrowserClockInstallOptions = {}): Promise<void> {
        const initialTime = resolveInitialTime(options);
        const tabId = this.activeTabId();
        this.requireAccess();
        this.model.target.assertTabId(tabId, "clock.install()");
        await this.model.target.ensureReady(tabId);

        if (this.registry().tabs.has(tabId)) await this.uninstallTab(tabId);
        const source = buildBrowserClockSource(initialTime);
        const cdp = this.model.target.cdp(tabId);
        let id: string;
        try {
            id = await cdp.addInitScript(source);
        } catch {
            throw new Error("Could not register browser clock for future documents.");
        }

        try {
            await cdp.evaluate(source);
        } catch {
            try { await cdp.removeInitScript(id); } catch { /* Keep the original install failure. */ }
            throw new Error("Could not install browser clock in the current document.");
        }

        this.registry().tabs.set(tabId, { id, initialTime });
    }

    async fastForward(ms: number): Promise<void> {
        if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
            throw new TypeError("clock.fastForward(ms) requires a finite, non-negative duration.");
        }
        const tabId = this.activeTabId();
        this.requireAccess();
        this.model.target.assertTabId(tabId, "clock.fastForward()");
        await this.model.target.ensureReady(tabId);
        const expression = `(() => { const clock = window[Symbol.for("persephone.browser-clock")]; if (!clock) throw new Error("Browser clock is not installed."); clock.fastForward(${ms}); })()`;
        try {
            await this.model.target.cdp(tabId).evaluate(expression);
        } catch {
            throw new Error("Could not advance browser clock.");
        }
    }

    async uninstall(): Promise<void> {
        const tabId = this.activeTabId();
        this.requireAccess();
        this.model.target.assertTabId(tabId, "clock.uninstall()");
        await this.model.target.ensureReady(tabId);
        await this.uninstallTab(tabId);
    }

    private async uninstallTab(tabId: string): Promise<void> {
        const registry = registries.get(this.model);
        const registration = registry?.tabs.get(tabId);
        if (!registration) return;
        await this.model.target.ensureReady(tabId);
        let failed = false;
        const cdp = this.model.target.cdp(tabId);
        try {
            await cdp.evaluate("window[Symbol.for('persephone.browser-clock')]?.uninstall()");
        } catch {
            failed = true;
        }
        try {
            await cdp.removeInitScript(registration.id);
        } catch {
            failed = true;
        }
        registry?.tabs.delete(tabId);
        this.releaseRegistryIfEmpty(registry);
        if (failed) throw new Error("Could not fully uninstall browser clock.");
    }

    private activeTabId(): string {
        const tabId = this.model.state.get().activeTabId;
        if (!tabId) throw new Error("No active browser tab.");
        return tabId;
    }

    private requireAccess(): void {
        const state = this.model.state.get();
        if (!agentMayAccessBrowserPage(state)) throw new Error(privateBrowserRefusal(state));
    }

    private registry(): ClockRegistry {
        let registry = registries.get(this.model);
        if (registry) return registry;
        const tabs = new Map<string, ClockRegistration>();
        const unsubscribe = this.model.state.subscribe(() => {
            const openTabIds = new Set(this.model.state.get().tabs.map((tab) => tab.id));
            for (const tabId of tabs.keys()) {
                if (!openTabIds.has(tabId)) tabs.delete(tabId);
            }
            if (tabs.size === 0) this.releaseRegistryIfEmpty(registries.get(this.model));
        });
        registry = { tabs, unsubscribe };
        registries.set(this.model, registry);
        return registry;
    }

    private releaseRegistryIfEmpty(registry: ClockRegistry | undefined): void {
        if (!registry || registry.tabs.size > 0) return;
        registry.unsubscribe();
        registries.delete(this.model);
    }
}

function resolveInitialTime(options: BrowserClockInstallOptions): number {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("clock.install(options) requires an options object.");
    }
    if (options.now === undefined) return Date.now();
    const value = options.now instanceof Date ? options.now.getTime() : typeof options.now === "number" ? options.now : typeof options.now === "string" ? Date.parse(options.now) : NaN;
    if (!Number.isFinite(value)) throw new TypeError("clock.install({ now }) requires a valid date, timestamp, or date string.");
    return value;
}
