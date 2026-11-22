import { agentMayUseBrowserTestPower, BROWSER_TEST_POWER_REFUSAL } from "./agent-access";
import type { BrowserEditor } from "./BrowserEditor";
import { pageClipboardRecorderSource } from "./page-clipboard-recorder";
import type { IAiMember, IAiVisionDescriptor, IAiVisible } from "ai-vision";

const MEMBERS: readonly IAiMember[] = [
    { name: "arm", kind: "method", signature: "arm(): Promise<void>", summary: "Observe this page's later text/plain clipboard writes in the current and future documents." },
    { name: "readText", kind: "method", signature: "readText(): Promise<string | null>", summary: "Read text/plain observed from this page's own writes; returns null until one is observed. Never reads the OS clipboard." },
    { name: "writeText", kind: "method", signature: "writeText(text: string): Promise<void>", summary: "Stage text for the page's next navigator.clipboard.readText() or trusted Ctrl+V / Shift+Insert paste." },
];

const registrations = new WeakMap<BrowserEditor, Map<string, string>>();

export class BrowserClipboardFacade implements IAiVisible {
    constructor(private readonly model: BrowserEditor) {}

    get aiVision(): IAiVisionDescriptor {
        return {
            kind: "BrowserClipboard",
            summary: "Page-scoped clipboard observation and one-shot test input.",
            members: MEMBERS,
            help: "Call arm() before the page action to observe. readText() reports only text/plain writes observed from this page and returns null before one; it never reads the OS clipboard. writeText(text) stages a one-shot navigator.clipboard.readText(), Ctrl+V, or Windows Shift+Insert value. Keyboard paste dispatches an untrusted paste event and uses insertText for an uncancelled editable target. Context-menu and Electron-menu Paste remain native.",
            summarize: () => ({ kind: "BrowserClipboard" }),
        };
    }

    async arm(): Promise<void> {
        const tabId = this.requireAccess();
        await this.ensureRecorder(tabId);
    }

    async readText(): Promise<string | null> {
        const tabId = this.requireAccess();
        await this.ensureRecorder(tabId);
        await this.model.target.ensureReady(tabId);
        const result: unknown = await this.model.target.cdp(tabId).evaluate(pageClipboardRecorderSource("read"));
        return typeof result === "string" ? result : null;
    }

    async writeText(text: string): Promise<void> {
        if (typeof text !== "string") throw new TypeError("clipboard.writeText(text) requires a string.");
        const tabId = this.requireAccess();
        await this.ensureRecorder(tabId);
        await this.model.target.ensureReady(tabId);
        await this.model.target.cdp(tabId).evaluate(pageClipboardRecorderSource("write", text));
    }

    async clearClipboardForTestRun(): Promise<void> {
        const tabId = this.requireAccess();
        await this.model.target.ensureReady(tabId);
        try {
            await this.model.target.cdp(tabId).evaluate(pageClipboardRecorderSource("reset"));
        } finally {
            await removeRegistration(this.model, tabId);
        }
    }

    private requireAccess(): string {
        if (!agentMayUseBrowserTestPower(this.model.state.get())) throw new Error(BROWSER_TEST_POWER_REFUSAL);
        const tabId = this.model.state.get().activeTabId;
        if (!tabId) throw new Error("No active browser tab.");
        this.model.target.assertTabId(tabId, "clipboard");
        return tabId;
    }

    private async ensureRecorder(tabId: string): Promise<void> {
        await this.model.target.ensureReady(tabId);
        let map = registrations.get(this.model);
        if (!map) {
            map = new Map();
            registrations.set(this.model, map);
        }
        if (!map.has(tabId)) {
            const id = await this.model.target.cdp(tabId).addInitScript(pageClipboardRecorderSource("install"));
            map.set(tabId, id);
        }
        await this.model.target.cdp(tabId).evaluate(pageClipboardRecorderSource("install"));
    }
}

/** Remove a tab's registration before its guest is released; the CDP removal is best-effort. */
export function releaseBrowserClipboardTab(model: BrowserEditor, tabId: string): void {
    const id = registrations.get(model)?.get(tabId);
    registrations.get(model)?.delete(tabId);
    if (!id) return;
    void removeInitScriptBestEffort(model, tabId, id);
}

async function removeRegistration(model: BrowserEditor, tabId: string): Promise<void> {
    const map = registrations.get(model);
    const id = map?.get(tabId);
    map?.delete(tabId);
    if (map?.size === 0) registrations.delete(model);
    if (!id) return;
    await model.target.cdp(tabId).removeInitScript(id);
}

async function removeInitScriptBestEffort(model: BrowserEditor, tabId: string, id: string): Promise<void> {
    try {
        await model.target.ensureReady(tabId);
        await model.target.cdp(tabId).removeInitScript(id);
    } catch { /* Tab release must continue if its CDP target is already unavailable. */ }
}
