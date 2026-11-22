import { app } from "../../api/app";
import { pages } from "../../api/pages";
import { ui } from "../../api/ui";
import { fs } from "../../api/fs";
import { siteExtensionStore } from "../../api/site-extensions";
import type { SiteExtensionRecord } from "../../api/site-extensions";
import type { SiteExtensionReloadResult, SiteActionOutcome, SiteActionResult } from "../../api/types/site-extensions";
import { siteExtensionTrust, sameSiteExtensionHostSet } from "../../api/site-extension-trust";
import { api } from "../../../ipc/renderer/api";
import { validateSiteActions } from "../../../shared/site-extension-actions";
import type { SiteActionItem } from "../../../shared/site-extension-actions";
import { validateSiteActionResult } from "./site-extension-actions";
import { SiteExtensionTrustPrompt } from "./site-extension-trust-prompt";
import type { BrowserEditor } from "./BrowserEditor";
import { isPrivateBrowserSession } from "./agent-access";
import { ensureTargetReady } from "../../automation/page-events";
import { evaluateInTarget, EvaluationError } from "../../automation/queries";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { withTimeout } from "../../core/utils/utils";
import { SiteActionDocument } from "./SiteActionDocument";
import { TComponentState } from "../../core/state/state";
import type { SiteExtensionTrustPromptData } from "./site-extension-trust-prompt";
import { TemporarySiteExtensions } from "./TemporarySiteExtensions";
import type { TemporarySiteExtensionEntry, TemporarySiteExtensionOptions } from "./TemporarySiteExtensions";
import { matchTemporarySiteExtensionHost } from "../../../shared/temporary-site-extension";
import { SiteExtensionInjection, temporarySiteExtensionPredicate } from "./SiteExtensionInjection";
import { mapTemporaryExtensionErrorLocation, resolveTemporaryExtensionSources, type TemporaryExtensionSourceFile } from "./temporary-extension-sources";

interface BrowserSiteExtensionState {
    siteExtensionTrustPrompts: SiteExtensionTrustPromptData[];
}

function stripExtensionErrorControls(message: string): string {
    return Array.from(message).filter((character) => {
        const code = character.charCodeAt(0);
        return !((code >= 0 && code <= 8) || code === 11 || code === 12
            || (code >= 14 && code <= 31) || (code >= 127 && code <= 159));
    }).join("");
}

function boundExtensionError(message: string): string {
    const sanitized = stripExtensionErrorControls(message);
    return sanitized.length > 512 ? `${sanitized.slice(0, 511)}…` : sanitized;
}

function pageExtensionError(message: string): string {
    const labelled = `Page-derived extension error: ${stripExtensionErrorControls(message)}`;
    return labelled.length > 512 ? `${labelled.slice(0, 511)}…` : labelled;
}

function temporaryExtensionDisplayName(scriptPath?: string | string[]): string {
    if (typeof scriptPath === "string") return scriptPath;
    if (scriptPath?.length) return `${scriptPath[0]} (+${scriptPath.length - 1} files)`;
    return "inline script";
}

function parseTemporaryExtensionError(value: string): { message: string; stack: string } {
    try {
        const parsed: unknown = JSON.parse(value);
        if (parsed && typeof parsed === "object") {
            const record = parsed as { message?: unknown; stack?: unknown };
            if (typeof record.message === "string") return {
                message: record.message,
                stack: typeof record.stack === "string" ? record.stack : "",
            };
        }
    } catch { /* older or malformed page result: preserve it as the message */ }
    return { message: value, stack: "" };
}

export class BrowserSiteExtensionController {
    private readonly model: BrowserEditor;
    readonly state = new TComponentState<BrowserSiteExtensionState>({ siteExtensionTrustPrompts: [] });
    readonly temporary = new TemporarySiteExtensions();
    private readonly siteDocuments = new Map<string, number>();
    private readonly injectedSiteExtensions = new Map<string, { documentId: number; name: string }>();
    readonly actionDocuments = new Map<string, SiteActionDocument>();
    private readonly actionChoices = new Map<string, { tabId: string; document: SiteActionDocument; expires: number; runVersion: number; items: Extract<SiteActionResult, { kind: "video" }> ["items"] }>();
    private readonly dismissedExtensionPrompts = new Set<string>();
    private readonly unsubscribeTrust: () => void;

    constructor(model: BrowserEditor) {
        this.model = model;
        this.unsubscribeTrust = siteExtensionTrust.subscribeSnapshot((snapshot) => this.refreshTrust(snapshot));
    }

    documentId(tabId: string): number {
        return this.siteDocuments.get(tabId) ?? 0;
    }

    activePrompt() {
        const activeTabId = this.model.state.get().activeTabId;
        return this.state.get().siteExtensionTrustPrompts.find((prompt) => prompt.internalTabId === activeTabId
            && prompt.documentId === this.documentId(prompt.internalTabId));
    }

    agentPrompt() {
        const prompt = this.activePrompt();
        return prompt ? {
            status: "waiting-for-user" as const,
            name: prompt.name,
            id: prompt.id,
            host: prompt.host,
            otherHosts: prompt.hosts.filter((host) => host !== prompt.host),
            fetchHosts: [...prompt.fetchHosts],
        } : undefined;
    }

    extensionName(tabId: string): string | undefined {
        const marker = this.injectedSiteExtensions.get(tabId);
        return marker?.documentId === this.documentId(tabId) ? marker.name : undefined;
    }

    onDocumentReady(tabId: string): void {
        void this.inject(tabId);
    }

    onNavigationStarted(tabId: string, isMainFrame: boolean, isSameDocument: boolean): void {
        if (isMainFrame && !isSameDocument) this.clear(tabId);
    }

    onNavigation(tabId: string): void {
        this.clear(tabId);
        this.temporary.forgetTab(tabId);
        this.siteDocuments.set(tabId, this.documentId(tabId) + 1);
        this.clearTrustPrompt(tabId);
        for (const key of this.dismissedExtensionPrompts) {
            if (key.startsWith(`${tabId}:`)) this.dismissedExtensionPrompts.delete(key);
        }
    }

    onTabReleased(tabId: string): void {
        this.clear(tabId);
        this.temporary.forgetTab(tabId);
    }

    onActiveTabChanged(tabId: string): void {
        const doc = this.actionDocuments.get(tabId);
        if (doc) {
            doc.runVersion++;
            doc.cancelRun?.();
        }
        for (const [token, choice] of this.actionChoices) {
            if (choice.tabId === tabId) this.actionChoices.delete(token);
        }
    }

    refreshTrust(snapshot = siteExtensionTrust.snapshot): void {
        for (const [tabId, doc] of this.actionDocuments) {
            if (!doc.isCurrent(false)) this.clear(tabId);
        }
        this.state.update((state) => {
            state.siteExtensionTrustPrompts = state.siteExtensionTrustPrompts.filter((prompt) => {
                const grant = snapshot[prompt.id];
                return !grant || !sameSiteExtensionHostSet(grant.hosts, prompt.hosts)
                    || !sameSiteExtensionHostSet(grant.fetchHosts, prompt.fetchHosts);
            });
        });
    }

    setTrustPrompt(prompt: SiteExtensionTrustPromptData): void {
        this.state.update((state) => {
            state.siteExtensionTrustPrompts = state.siteExtensionTrustPrompts.filter((item) => item.internalTabId !== prompt.internalTabId);
            state.siteExtensionTrustPrompts.push(prompt);
        });
    }

    clearTrustPrompt(tabId: string, documentId?: number): void {
        this.state.update((state) => {
            state.siteExtensionTrustPrompts = state.siteExtensionTrustPrompts.filter((item) =>
                item.internalTabId !== tabId || (documentId !== undefined && item.documentId !== documentId));
        });
    }

    private currentDocument(tabId: string, documentId: number, host: string): boolean {
        if (this.documentId(tabId) !== documentId) return false;
        const webview = this.model.webview.get(tabId);
        if (!webview) return false;
        try {
            const current = new URL(webview.getURL());
            return current.protocol === "https:" && current.hostname === host;
        } catch { return false; }
    }

    listTemporary(): ReturnType<TemporarySiteExtensions["list"]> { return this.temporary.list(); }

    async attachTemporary(options: TemporarySiteExtensionOptions): Promise<{
        host: string;
        targets: { id: string; status: "injected" | "deferred" | "error"; error?: string }[];
    }> {
        const { entry, previous } = await this.temporary.attach(options);
        const targets: { id: string; status: "injected" | "deferred" | "error"; error?: string }[] = [];
        const tabs = this.model.state.get().tabs;
        const cleanupFailures = previous
            ? new Map((await this.cleanupTemporaryRevision(previous, tabs.map((tab) => tab.id))).map((failure) => [failure.id, failure.error]))
            : new Map<string, string>();
        for (const prompt of [...this.state.get().siteExtensionTrustPrompts]) {
            const promptTab = this.model.webview.get(prompt.internalTabId);
            if (!promptTab) continue;
            try {
                if (this.temporary.match(new URL(promptTab.getURL())) === entry) {
                    this.clearTrustPrompt(prompt.internalTabId, prompt.documentId);
                }
            } catch { /* A prompt for a non-HTTP document remains governed by the saved path. */ }
        }
        for (const tab of tabs) {
            const webview = this.model.webview.get(tab.id);
            let url: URL;
            try { url = new URL(webview?.getURL() ?? tab.url); } catch { continue; }
            if (this.temporary.match(url) !== entry) continue;
            const cleanupError = cleanupFailures.get(tab.id);
            if (cleanupError) {
                targets.push({ id: tab.id, status: "error", error: cleanupError });
                this.temporary.record(entry, tab.id, { status: "error", error: cleanupError });
                continue;
            }
            if (!webview || !this.model.webview.isReady(tab.id)) {
                targets.push({ id: tab.id, status: "deferred" });
                this.temporary.record(entry, tab.id, { status: "deferred" });
                continue;
            }
            this.temporary.record(entry, tab.id, { status: "pending" });
            const result = await this.injectTemporaryExtension(tab.id, entry);
            if (result.status === "injected") {
                targets.push({ id: tab.id, status: "injected" });
                this.temporary.record(entry, tab.id, { status: "injected" });
            } else if (result.status === "extension-error") {
                targets.push({ id: tab.id, status: "error", error: result.error });
                this.temporary.record(entry, tab.id, { status: "error", error: result.error });
            } else {
                targets.push({ id: tab.id, status: "deferred" });
                this.temporary.record(entry, tab.id, { status: "deferred" });
            }
        }
        return { host: entry.host, targets };
    }

    async detachTemporary(host: string): Promise<{ status: "detached" | "not-found"; errors: { id: string; error: string }[] }> {
        const entry = this.temporary.remove(host);
        if (!entry) return { status: "not-found", errors: [] };
        const errors = await this.cleanupTemporaryRevision(entry, this.model.state.get().tabs.map((tab) => tab.id));
        return { status: "detached", errors };
    }

    private async cleanupTemporaryRevision(entry: TemporarySiteExtensionEntry, tabIds: string[]): Promise<{ id: string; error: string }[]> {
        const errors: { id: string; error: string }[] = [];
        for (const tabId of tabIds) {
            const doc = this.actionDocuments.get(tabId);
            if (!doc || doc.source.kind !== "temporary" || doc.source.entry.revision !== entry.revision) continue;
            doc.cancel();
            const webview = this.model.webview.get(tabId);
            const current = (): boolean => this.documentId(tabId) === doc.documentId && this.actionDocuments.get(tabId) === doc
                && !!webview && this.model.webview.get(tabId) === webview && this.model.webview.isReady(tabId) && doc.isCurrentDocument();
            if (!webview || !this.model.webview.isReady(tabId) || !current()) {
                this.clear(tabId, false);
                this.model.pageRemote.clear(tabId);
                errors.push({ id: tabId, error: "The document became unavailable before extension cleanup; reload the tab to undo page effects." });
                continue;
            }
            try {
                const teardown = SiteExtensionInjection.createTeardownExpression(temporarySiteExtensionPredicate(entry.hostname, entry.explicitPort), doc.id);
                const result = await evaluateInTarget(this.model.target, teardown, tabId);
                if (!current() || String(result) !== "ok") {
                    errors.push({ id: tabId, error: "The extension cleanup could not be confirmed; reload the tab to undo page effects." });
                }
            } catch (error) {
                errors.push({ id: tabId, error: boundExtensionError(errMessage(error, "Extension cleanup failed.")) });
            }
            if (this.actionDocuments.get(tabId) === doc) {
                this.clear(tabId);
                this.model.pageRemote.clear(tabId);
                this.model.pageRemote.resetForSiteExtensionReload(tabId);
                void this.model.pageRemote.probeForSiteExtensionReload(tabId).catch((): undefined => undefined);
            }
        }
        return errors;
    }

    private clear(tabId: string, targetAttached = true): void {
        const actions = this.actionDocuments.get(tabId);
        if (targetAttached) actions?.cancel();
        else actions?.cancelAfterTargetDetach();
        this.actionDocuments.delete(tabId);
        for (const [token, choice] of this.actionChoices) {
            if (choice.tabId === tabId) this.actionChoices.delete(token);
        }
        if (this.injectedSiteExtensions.delete(tabId) || actions) this.model.pageRemote.notifyChanged();
    }

    dispose(): void {
        this.unsubscribeTrust();
        for (const tabId of new Set([...this.injectedSiteExtensions.keys(), ...this.actionDocuments.keys()])) this.clear(tabId, false);
        this.temporary.clear();
        this.siteDocuments.clear();
        this.dismissedExtensionPrompts.clear();
        this.actionChoices.clear();
    }

    private setMarker(tabId: string, documentId: number, name: string): void {
        const previous = this.injectedSiteExtensions.get(tabId);
        if (previous?.documentId === documentId && previous.name === name) return;
        this.injectedSiteExtensions.set(tabId, { documentId, name });
        this.model.pageRemote.notifyChanged();
    }

    async trustPrompt(tabId: string, documentId: number): Promise<"trusted" | "changed" | "unavailable" | "not-current"> {
        const prompt = this.state.get().siteExtensionTrustPrompts.find((item) => item.internalTabId === tabId && item.documentId === documentId);
        if (!prompt || !this.currentDocument(tabId, documentId, prompt.host)) return "not-current";
        if (!prompt.available) return "unavailable";
        const current = await siteExtensionStore.findForHost(prompt.host).catch((): undefined => undefined);
        if (!this.currentDocument(tabId, documentId, prompt.host)) return "not-current";
        if (!current || current.id !== prompt.id || !sameSiteExtensionHostSet(current.hosts, prompt.hosts)
            || !sameSiteExtensionHostSet(current.fetchHosts, prompt.fetchHosts)) {
            if (current) this.setTrustPrompt(SiteExtensionTrustPrompt.from(current, tabId, documentId, prompt.host));
            else this.setTrustPrompt({ ...prompt, available: false });
            return current ? "changed" : "unavailable";
        }
        await siteExtensionTrust.trust(current.id, prompt.hosts, prompt.fetchHosts);
        if (!this.currentDocument(tabId, documentId, prompt.host)) return "trusted";
        this.clearTrustPrompt(tabId, documentId);
        await this.injectTrustedExtension(tabId, current, documentId);
        return "trusted";
    }

    dismissPrompt(tabId: string, documentId: number): void {
        this.dismissedExtensionPrompts.add(`${tabId}:${documentId}`);
        this.clearTrustPrompt(tabId, documentId);
    }

    private isPromptDismissed(tabId: string, documentId: number): boolean {
        return this.dismissedExtensionPrompts.has(`${tabId}:${documentId}`);
    }

    async reload(): Promise<SiteExtensionReloadResult> {
        const tabId = this.model.state.get().activeTabId;
        const documentId = this.documentId(tabId);
        const activeWebview = this.model.webview.get(tabId);
        if (activeWebview) {
            try {
                const temporary = this.temporary.match(new URL(activeWebview.getURL()));
                if (temporary) {
                    if (!this.model.webview.isReady(tabId)) return { status: "not-current", registered: false };
                    const injected = await this.injectTemporaryExtension(tabId, temporary, true);
                    if (injected.status === "extension-error") return { status: "extension-error", registered: false, error: injected.error };
                    if (injected.status !== "injected") return { status: "not-current", registered: false };
                    return { status: "injected", registered: this.model.pageRemote.getRegistration(tabId) !== undefined };
                }
            } catch { /* Saved-extension selection handles non-URL documents. */ }
        }
        const currentHost = (): string | undefined => {
            if (isPrivateBrowserSession(this.model.state.get())) return undefined;
            const webview = this.model.webview.get(tabId);
            if (!webview || !this.model.webview.isReady(tabId)) return undefined;
            try { const url = new URL(webview.getURL()); return url.protocol === "https:" ? url.hostname : undefined; }
            catch { return undefined; }
        };
        const isCurrent = (host: string): boolean => this.model.state.get().activeTabId === tabId
            && this.model.webview.isReady(tabId) && !isPrivateBrowserSession(this.model.state.get())
            && this.currentDocument(tabId, documentId, host);
        const notCurrent = (): SiteExtensionReloadResult => ({ status: "not-current", registered: false });
        const host = currentHost();
        if (!host || !isCurrent(host)) return notCurrent();
        await siteExtensionTrust.load().catch((): undefined => undefined);
        if (!isCurrent(host)) return notCurrent();
        let extension = await siteExtensionStore.findForHost(host).catch((): undefined => undefined);
        if (!isCurrent(host)) return notCurrent();
        if (!extension) return { status: "no-extension", registered: false };
        const grant = siteExtensionTrust.get(extension.id);
        if (grant && !grant.enabled) return { status: "disabled", registered: false };
        if (!siteExtensionTrust.isGranted(extension)) {
            this.showTrustPrompt(tabId, documentId, extension, host);
            return { status: "waiting-for-user", registered: false };
        }
        const webview = this.model.webview.get(tabId);
        if (!webview || !this.model.webview.isReady(tabId) || !isCurrent(host)) return notCurrent();
        try {
            const cdp = this.model.target.cdp(tabId);
            if (!await cdp.attach({ aiVisionBinding: true })) return notCurrent();
            if (!isCurrent(host)) return notCurrent();
            await ensureTargetReady(this.model.target, tabId);
            if (!isCurrent(host)) return notCurrent();
            const currentExtension = await siteExtensionStore.findForHost(host);
            if (!isCurrent(host)) return notCurrent();
            if (!currentExtension) return { status: "no-extension", registered: false };
            extension = currentExtension;
            const currentGrant = siteExtensionTrust.get(extension.id);
            if (currentGrant && !currentGrant.enabled) return { status: "disabled", registered: false };
            if (!siteExtensionTrust.isGranted(currentExtension)) {
                this.showTrustPrompt(tabId, documentId, extension, host);
                return { status: "waiting-for-user", registered: false };
            }
            const teardown = SiteExtensionInjection.createTeardownExpression(`location.protocol === "https:" && location.hostname === ${JSON.stringify(host)}`, extension.id);
            this.clear(tabId);
            const teardownResult = await evaluateInTarget(this.model.target, teardown, tabId);
            if (!isCurrent(host)) return notCurrent();
            if (String(teardownResult) !== "ok") return notCurrent();
            this.clear(tabId);
            this.model.pageRemote.clear(tabId);
            this.model.pageRemote.resetForSiteExtensionReload(tabId);
            const generation = this.model.pageRemote.documentGeneration(tabId);
            if (generation === undefined || !isCurrent(host)) return notCurrent();
            const injection = await this.injectTrustedExtension(tabId, extension, documentId, false);
            if (!isCurrent(host)) return notCurrent();
            if (injection.status !== "injected") return injection.status === "extension-error"
                ? { status: "extension-error", registered: false, error: injection.error } : notCurrent();
            const deadline = Date.now() + 3_000;
            await withTimeout(this.model.pageRemote.probeForSiteExtensionReload(tabId), Math.max(0, deadline - Date.now()), undefined);
            if (!isCurrent(host)) return notCurrent();
            const registeredSinceReload = (): boolean => {
                const registration = this.model.pageRemote.getRegistration(tabId);
                return registration !== undefined && registration.generation >= generation;
            };
            while (Date.now() < deadline) {
                if (registeredSinceReload()) return { status: "injected", registered: true };
                await new Promise<void>((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())));
                if (!isCurrent(host)) return notCurrent();
            }
            return { status: "injected", registered: registeredSinceReload() };
        } catch (error) {
            if (!isCurrent(host)) return notCurrent();
            return { status: "extension-error", registered: false, error: boundExtensionError(errMessage(error, "Extension reload failed.")) };
        }
    }

    private showTrustPrompt(tabId: string, documentId: number, extension: SiteExtensionRecord, host: string): void {
        if (this.isPromptDismissed(tabId, documentId)) return;
        this.setTrustPrompt(SiteExtensionTrustPrompt.from(extension, tabId, documentId, host));
    }

    private async inject(tabId: string): Promise<void> {
        const webview = this.model.webview.get(tabId);
        if (!webview) return;
        let pageUrl: URL;
        try { pageUrl = new URL(webview.getURL()); } catch { return; }
        const documentId = this.documentId(tabId);
        const temporary = this.temporary.match(pageUrl);
        if (temporary) {
            this.clearTrustPrompt(tabId);
            const result = await this.injectTemporaryExtension(tabId, temporary);
            this.temporary.record(temporary, tabId, result.status === "injected"
                ? { status: "injected" }
                : result.status === "extension-error" ? { status: "error", error: result.error } : { status: "deferred" });
            return;
        }
        await siteExtensionTrust.load().catch((): undefined => undefined);
        if (isPrivateBrowserSession(this.model.state.get())) return;
        if (pageUrl.protocol !== "https:") return;
        const extension = await siteExtensionStore.findForHost(pageUrl.hostname).catch((): undefined => undefined);
        if (!extension || !this.currentDocument(tabId, documentId, pageUrl.hostname)) return;
        const grant = siteExtensionTrust.get(extension.id);
        if (siteExtensionTrust.isGranted(extension)) {
            await this.injectTrustedExtension(tabId, extension, documentId);
            return;
        }
        if (grant && !grant.enabled) return;
        if (!this.isPromptDismissed(tabId, documentId)) {
            this.setTrustPrompt(SiteExtensionTrustPrompt.from(extension, tabId, documentId, pageUrl.hostname));
        }
    }

    private async injectTrustedExtension(
        tabId: string,
        extension: SiteExtensionRecord,
        documentId: number,
        probeAfterInjection = true,
    ): Promise<{ status: "injected" } | { status: "not-current" } | { status: "extension-error"; error: string }> {
        return this.injectSelectedExtension({ kind: "saved", extension }, tabId, documentId, probeAfterInjection);
    }

    private async injectTemporaryExtension(
        tabId: string,
        entry: TemporarySiteExtensionEntry,
        force = false,
    ): Promise<{ status: "injected" } | { status: "not-current" } | { status: "extension-error"; error: string }> {
        return this.injectSelectedExtension({ kind: "temporary", entry }, tabId, this.documentId(tabId), true, force);
    }

    private async injectSelectedExtension(
        selection: { kind: "saved"; extension: SiteExtensionRecord } | { kind: "temporary"; entry: TemporarySiteExtensionEntry },
        tabId: string,
        documentId: number,
        probeAfterInjection = true,
        force = false,
    ): Promise<{ status: "injected" } | { status: "not-current" } | { status: "extension-error"; error: string }> {
        const webview = this.model.webview.get(tabId);
        if (!webview || (selection.kind === "saved" && isPrivateBrowserSession(this.model.state.get()))) return { status: "not-current" };
        let pageUrl: URL;
        try { pageUrl = new URL(webview.getURL()); } catch { return { status: "not-current" }; }
        const id = selection.kind === "saved"
            ? selection.extension.id
            : `temporary-${selection.entry.revision}-${crypto.randomUUID()}`;
        const name = selection.kind === "saved"
            ? selection.extension.name
            : selection.entry.name ?? temporaryExtensionDisplayName(selection.entry.scriptPath);
        const host = selection.kind === "saved" ? pageUrl.hostname : selection.entry.hostname;
        const pageIdentityCurrent = (): boolean => {
            if (this.documentId(tabId) !== documentId) return false;
            const target = this.model.webview.get(tabId);
            if (!target) return false;
            try {
                const current = new URL(target.getURL());
                if (selection.kind === "saved") return current.protocol === "https:" && current.hostname === host;
                return selection.kind === "temporary"
                    && matchTemporarySiteExtensionHost(current, [selection.entry])?.entry === selection.entry;
            } catch { return false; }
        };
        const isAllowed = (): boolean => selection.kind === "saved"
            ? !isPrivateBrowserSession(this.model.state.get()) && siteExtensionTrust.isGranted(selection.extension)
                && selection.extension.hosts.includes(pageUrl.hostname) && this.currentDocument(tabId, documentId, pageUrl.hostname)
            : this.temporary.isCurrent(selection.entry) && pageIdentityCurrent();
        const pagePredicate = selection.kind === "saved"
            ? `location.protocol === "https:" && location.hostname === ${JSON.stringify(host)}`
            : temporarySiteExtensionPredicate(selection.entry.hostname, selection.entry.explicitPort);
        if ((selection.kind === "saved" && pageUrl.protocol !== "https:") || !isAllowed()) return { status: "not-current" };
        let expression: string;
        let sourceStartLine: number;
        let sourceFiles: TemporaryExtensionSourceFile[] = [];
        try {
            const sourcePromise = selection.kind === "saved"
                ? fs.read(selection.extension.scriptPath).then((source) => ({ source, files: [] as TemporaryExtensionSourceFile[] }))
                : selection.entry.source !== undefined
                    ? Promise.resolve({ source: selection.entry.source, files: [] as TemporaryExtensionSourceFile[] })
                    : selection.entry.scriptPath === undefined
                        ? Promise.reject(new Error("Temporary extension has no scriptPath."))
                        : resolveTemporaryExtensionSources(selection.entry.scriptPath).then((resolved) => {
                            sourceFiles = resolved.files;
                            return resolved;
                        });
            const [resolvedSource, runtime] = await Promise.all([sourcePromise, api.getSiteExtensionRuntime()]);
            if (!isAllowed()) return { status: "not-current" };
            const built = SiteExtensionInjection.createExpression({
                host,
                id,
                policyExpression: pagePredicate,
                params: selection.kind === "temporary" ? selection.entry.serializedParams : "{}",
                runtime,
                source: resolvedSource.source,
            });
            expression = built.expression;
            sourceStartLine = built.sourceStartLine;
        } catch (error) {
            console.warn(`[site-extension] ${id}: extension files could not be read`);
            return { status: "extension-error", error: boundExtensionError(`Extension files could not be read: ${errMessage(error, "read failed")}`) };
        }
        if (!isAllowed()) return { status: "not-current" };
        let result: unknown;
        let actionDocument: SiteActionDocument | undefined;
        const clearOwnActions = (): void => {
            if (!actionDocument || this.actionDocuments.get(tabId) !== actionDocument) return;
            if (actionDocument.source.kind === "temporary") {
                actionDocument.cancel();
                actionDocument.pending = undefined;
                actionDocument.items = [];
                this.model.pageRemote.notifyChanged();
            } else this.clear(tabId);
        };
        try {
            const cdp = this.model.target.cdp(tabId);
            if (!await cdp.attach({ aiVisionBinding: true })) {
                console.warn(`[site-extension] ${id}: CDP attach failed`);
                return selection.kind === "temporary"
                    ? { status: "extension-error", error: "Browser target could not be attached for injection." }
                    : { status: "not-current" };
            }
            if (!isAllowed()) return { status: "not-current" };
            await ensureTargetReady(this.model.target, tabId);
            if (!isAllowed()) return { status: "not-current" };
            const existing = this.actionDocuments.get(tabId);
            if (!existing && selection.kind === "temporary") {
                const teardown = SiteExtensionInjection.createExistingTeardownExpression(pagePredicate);
                const tornDown = await evaluateInTarget(this.model.target, teardown, tabId);
                if (!isAllowed()) return { status: "not-current" };
                if (String(tornDown) !== "none" && String(tornDown) !== "ok") {
                    return { status: "extension-error", error: "A previous page extension could not be cleaned up." };
                }
                if (String(tornDown) === "ok") {
                    this.model.pageRemote.clear(tabId);
                    this.model.pageRemote.resetForSiteExtensionReload(tabId);
                }
            }
            if (existing) {
                const sameTemporary = selection.kind === "temporary" && existing.source.kind === "temporary"
                    && existing.source.entry.revision === selection.entry.revision;
                const sameSaved = selection.kind === "saved" && existing.source.kind === "saved" && existing.id === id;
                if ((sameTemporary || sameSaved) && existing.isCurrent(false) && !force) {
                    return existing.injected ? { status: "injected" } : { status: "not-current" };
                }
                if (pageIdentityCurrent()) {
                    const existingPolicy = existing.source.kind === "temporary"
                        ? temporarySiteExtensionPredicate(existing.source.entry.hostname, existing.source.entry.explicitPort)
                        : `location.protocol === "https:" && location.hostname === ${JSON.stringify(existing.host)}`;
                    const teardown = SiteExtensionInjection.createTeardownExpression(existingPolicy, existing.id);
                    const tornDown = await evaluateInTarget(this.model.target, teardown, tabId);
                    if (!isAllowed()) return { status: "not-current" };
                    if (String(tornDown) !== "ok") return selection.kind === "temporary"
                        ? { status: "extension-error", error: "The previous page extension could not be cleaned up." }
                        : { status: "not-current" };
                }
                this.clear(tabId);
                this.model.pageRemote.clear(tabId);
                this.model.pageRemote.resetForSiteExtensionReload(tabId);
            }
            this.clear(tabId);
            const hosts = selection.kind === "saved" ? [...selection.extension.hosts] : [selection.entry.hostname];
            const fetchHosts = selection.kind === "saved" ? [...selection.extension.fetchHosts] : [];
            actionDocument = new SiteActionDocument(this.model, tabId, documentId, pageUrl.hostname, id,
                hosts, fetchHosts, this.model.target,
                pageIdentityCurrent,
                selection.kind === "temporary"
                    ? { kind: "temporary", entry: selection.entry, isCurrent: () => this.temporary.isCurrent(selection.entry) }
                    : { kind: "saved" });
            this.actionDocuments.set(tabId, actionDocument);
            result = await evaluateInTarget(this.model.target, expression, tabId);
        } catch (error) {
            clearOwnActions();
            console.warn(`[site-extension] ${id}: ${errMessage(error, "injection failed").slice(0, 256)}`);
            const location = error instanceof EvaluationError && error.exceptionLineNumber !== undefined
                ? mapTemporaryExtensionErrorLocation({ lineNumber: error.exceptionLineNumber, lineNumberIsZeroBased: true }, sourceStartLine, sourceFiles)
                : undefined;
            return { status: "extension-error", error: boundExtensionError(`Extension evaluation failed${location ? ` at ${location}` : ""}: ${errMessage(error, "injection failed")}`) };
        }
        if (!isAllowed() || this.actionDocuments.get(tabId) !== actionDocument) { clearOwnActions(); return { status: "not-current" }; }
        const detail = String(result);
        if (detail !== "ok") clearOwnActions();
        if (detail.startsWith("extension-error:")) {
            console.warn(`[site-extension] ${id}: extension script failed`);
            const payload = parseTemporaryExtensionError(detail.slice("extension-error:".length));
            const location = payload.stack
                ? mapTemporaryExtensionErrorLocation({ stack: payload.stack }, sourceStartLine, sourceFiles)
                : undefined;
            return { status: "extension-error", error: pageExtensionError(`${location ? `${location}: ` : ""}${payload.message}`) };
        }
        if (detail === "host-mismatch" || detail === "already-injected") return { status: "not-current" };
        if (detail !== "ok") return { status: "extension-error", error: boundExtensionError("Extension evaluation returned an unexpected result.") };
        const actions = this.actionDocuments.get(tabId);
        if (actions && actions.isCurrent(false)) {
            actions.injected = true;
            this.model.pageRemote.notifyChanged();
        }
        this.setMarker(tabId, documentId, name);
        if (probeAfterInjection) this.model.pageRemote.probeAfterSiteExtensionInjection(tabId);
        return { status: "injected" };
    }

    acceptSignal(tabId: string, data: { mainContext?: boolean; executionContextId?: number }, signal: unknown): boolean {
        if (!signal || typeof signal !== "object") return false;
        const type = (signal as { type?: unknown }).type;
        if (type === "fetch-cancel") {
            const doc = this.actionDocuments.get(tabId);
            if (doc && data.mainContext && typeof data.executionContextId === "number"
                && (doc.contextId === undefined || doc.contextId === data.executionContextId)
                && Object.keys(signal).length === 1 && doc.isCurrent(false)) {
                doc.fetchRequests.clear();
                if (doc.source.kind === "saved") void api.cancelSiteExtensionFetches(doc.fetchKey).catch((): undefined => undefined);
            }
            return true;
        }
        if (type === "fetch-request") { this.acceptFetchRequest(tabId, data, signal); return true; }
        if (type === "actions-published") { this.acceptActionPublication(tabId, data, signal); return true; }
        return false;
    }

    private acceptFetchRequest(tabId: string, data: { mainContext?: boolean; executionContextId?: number }, value: object): void {
        const doc = this.actionDocuments.get(tabId);
        const request = value as { id?: unknown; url?: unknown };
        if (!doc || !data.mainContext || typeof data.executionContextId !== "number" || !doc.isCurrent(false)
            || (doc.contextId !== undefined && doc.contextId !== data.executionContextId)
            || Object.keys(value).some((key) => key !== "type" && key !== "id" && key !== "url")
            || !Number.isSafeInteger(request.id) || (request.id as number) < 1
            || typeof request.url !== "string" || request.url.length > 4096) return;
        doc.contextId = data.executionContextId;
        const id = request.id as number;
        if (doc.fetchRequests.has(id)) return;
        if (doc.source.kind === "temporary") {
            doc.resolveFetch(id, { error: "Fetch is unavailable for temporary site extensions" });
            return;
        }
        const respond = (result: { text?: string; error?: string }): void => {
            if (!doc.fetchRequests.has(id) || !doc.isCurrent(false) || doc.contextId !== data.executionContextId) return;
            doc.resolveFetch(id, result);
        };
        if (doc.fetchRequests.size >= 4) {
            doc.resolveFetch(id, { error: "Too many fetch requests" });
            return;
        }
        doc.fetchRequests.add(id);
        void api.fetchSiteExtensionText(doc.fetchKey, doc.id, request.url)
            .then(respond, () => respond({ error: "Fetch failed" }))
            .finally(() => doc.fetchRequests.delete(id));
    }

    private acceptActionPublication(tabId: string, data: { mainContext?: boolean; executionContextId?: number }, value: object): void {
        const doc = this.actionDocuments.get(tabId);
        if (!doc || !data.mainContext || typeof data.executionContextId !== "number" || !doc.isCurrent(false)
            || (doc.contextId !== undefined && doc.contextId !== data.executionContextId)) return;
        const envelope = value as { items?: unknown };
        if (Object.keys(value).some((key) => key !== "type" && key !== "items")) return;
        let items: SiteActionItem[];
        try { items = validateSiteActions(envelope.items, false).items; } catch { return; }
        doc.contextId = data.executionContextId;
        doc.pending = items;
        const publish = (): void => {
            doc.timer = undefined;
            if (!doc.isCurrent(false) || !doc.pending) return;
            doc.items = doc.pending;
            doc.pending = undefined;
            doc.lastPublish = Date.now();
            this.model.pageRemote.notifyChanged();
        };
        if (doc.timer) return;
        const delay = Math.max(0, doc.lastPublish + 100 - Date.now());
        if (delay) doc.timer = setTimeout(publish, delay); else publish();
    }

    actions(tabId = this.model.state.get().activeTabId): SiteActionItem[] {
        const doc = this.actionDocuments.get(tabId);
        return doc?.injected && doc.isCurrent(false) ? structuredClone(doc.items) : [];
    }

    async runAction(id: string): Promise<SiteActionOutcome> {
        const tabId = this.model.state.get().activeTabId;
        const doc = this.actionDocuments.get(tabId);
        const contains = (items: SiteActionItem[]): boolean => items.some((item) => item.children?.length ? contains(item.children) : item.id === id);
        if (!doc?.injected || doc.contextId === undefined || !doc.isCurrent(true)) return { status: "not-current" };
        if (!contains(doc.items)) return { status: "error", error: t("browser.siteActionUnknown") };
        if (doc.running) return { status: "busy" };
        doc.running = true;
        const runVersion = ++doc.runVersion;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expression = `(async () => {
    try {
        const value = await window.__persephoneSiteRuntime.invokeAction(${JSON.stringify(id)});
        if (typeof value !== "string" || value.length > 2097152 || new TextEncoder().encode(value).byteLength > 2097152) throw new Error("Invalid action result size");
        return value;
    } catch (error) {
        let message = "Action handler failed";
        try { message = String(error && typeof error === "object" && "message" in error ? error.message : error).slice(0, 512); } catch { /* Use fallback. */ }
        throw new Error(message);
    }
})()`;
        const operation = this.model.target.cdp(tabId).send("Runtime.evaluate", {
            expression, contextId: doc.contextId, awaitPromise: true, returnByValue: true,
        }).then((response) => {
            if (response.exceptionDetails) {
                const description = String(response.exceptionDetails.exception?.description ?? "Action handler failed");
                throw new Error(description.split("\n")[0].replace(/^Error: /, "").slice(0, 512));
            }
            return response.result?.value as unknown;
        });
        let timedOut = false;
        let settled = false;
        const cancelled = Symbol("cancelled");
        const cancellation = new Promise<typeof cancelled>((resolve) => { doc.cancelRun = () => resolve(cancelled); });
        void operation.then(() => { settled = true; if (timedOut) doc.running = false; }, () => { settled = true; if (timedOut) doc.running = false; });
        try {
            const result = await Promise.race([operation, cancellation, new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), 60_000); })]);
            if (result === cancelled) { timedOut = !settled; return { status: "not-current" }; }
            if (doc.runVersion !== runVersion || !doc.isCurrent(true)) return { status: "not-current" };
            if (result === undefined) { timedOut = !settled; throw new Error(t("browser.siteActionTimeout")); }
            const outcome = await this.openActionResult(tabId, doc, runVersion, validateSiteActionResult(result));
            // An opened result already happened, and opening a URL as a new inner tab of this page is
            // itself what makes the document stop being current; report what was done.
            if (outcome.status === "opened") return outcome;
            return doc.runVersion === runVersion && doc.isCurrent(true) ? outcome : { status: "not-current" };
        } catch (error) {
            if (doc.runVersion !== runVersion || !doc.isCurrent(true)) return { status: "not-current" };
            const message = boundExtensionError(errMessage(error, t("browser.siteActionFailure")));
            ui.notify(t("browser.siteActionFailed", { error: message }), "error");
            return { status: "error", error: message };
        } finally { if (timer) clearTimeout(timer); doc.cancelRun = undefined; if (!timedOut) doc.running = false; }
    }

    private async openActionResult(tabId: string, doc: SiteActionDocument, runVersion: number, result: SiteActionResult): Promise<SiteActionOutcome> {
        if (doc.runVersion !== runVersion || !doc.isCurrent(true)) return { status: "not-current" };
        if (result.kind === "message") { ui.notify(result.text, "info"); return { status: "message", text: result.text }; }
        if (result.kind === "url") { await app.openRawLink(result.url); return { status: "opened" }; }
        if (result.kind === "links") {
            pages.lifecycle.openLinks(result.items.map((item) => ({ title: item.title, href: item.url, category: "", tags: [] as string[], isDirectory: false })), result.title);
            return { status: "opened" };
        }
        if (result.kind === "text") {
            const formats = { markdown: ["md-view", "markdown"], json: ["grid-json", "json"], csv: ["grid-csv", "csv"], plain: ["monaco", "plaintext"] } as const;
            const [editor, language] = formats[result.format];
            pages.lifecycle.addEditorPage(editor, language, result.title, result.content);
            return { status: "opened" };
        }
        if (result.items.length > 1) {
            const token = crypto.randomUUID();
            for (const [key, choice] of this.actionChoices) if (choice.expires < Date.now() || choice.tabId === tabId) this.actionChoices.delete(key);
            this.actionChoices.set(token, { tabId, document: doc, expires: Date.now() + 60_000, runVersion, items: result.items });
            return { status: "choice-required", token, choices: result.items.map((item) => ({ label: item.label })) };
        }
        return this.openActionVideo(tabId, doc, runVersion, result.items[0]);
    }

    private async openActionVideo(tabId: string, doc: SiteActionDocument, runVersion: number, item: Extract<SiteActionResult, { kind: "video" }> ["items"][number]): Promise<SiteActionOutcome> {
        const opened = await pages.openSiteActionVideo({ url: item.url, method: "GET", body: "", headers: item.headers ?? {} },
            () => doc.runVersion === runVersion && doc.isCurrent(true));
        return { status: opened ? "opened" : "not-current" };
    }

    async chooseResult(token: string, index: number): Promise<SiteActionOutcome> {
        const choice = this.actionChoices.get(token);
        this.actionChoices.delete(token);
        const doc = choice && this.actionDocuments.get(choice.tabId);
        if (!choice || !doc || choice.document !== doc || choice.runVersion !== doc.runVersion || choice.expires < Date.now()
            || !Number.isInteger(index) || !choice.items[index] || !doc.isCurrent(true)) return { status: "not-current" };
        try {
            const outcome = await this.openActionVideo(choice.tabId, doc, choice.runVersion, choice.items[index]);
            return choice.runVersion === doc.runVersion && doc.isCurrent(true) ? outcome : { status: "not-current" };
        } catch (error) {
            if (!doc.isCurrent(true) || choice.runVersion !== doc.runVersion) return { status: "not-current" };
            const message = boundExtensionError(errMessage(error));
            ui.notify(t("browser.siteActionFailed", { error: message }), "error");
            return { status: "error", error: message };
        }
    }
}
