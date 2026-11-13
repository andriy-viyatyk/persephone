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
import { ensureTargetReady, evaluateInTarget } from "../../automation/operations";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { withTimeout } from "../../core/utils/utils";
import { SiteActionDocument } from "./SiteActionDocument";
import { TComponentState } from "../../core/state/state";
import type { SiteExtensionTrustPromptData } from "./site-extension-trust-prompt";

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

export class BrowserSiteExtensionController {
    private readonly model: BrowserEditor;
    readonly state = new TComponentState<BrowserSiteExtensionState>({ siteExtensionTrustPrompts: [] });
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
        this.siteDocuments.set(tabId, this.documentId(tabId) + 1);
        this.clearTrustPrompt(tabId);
        for (const key of this.dismissedExtensionPrompts) {
            if (key.startsWith(`${tabId}:`)) this.dismissedExtensionPrompts.delete(key);
        }
    }

    onTabReleased(tabId: string): void {
        this.clear(tabId);
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
            const teardown = `(() => {
    if (location.protocol !== "https:" || location.hostname !== ${JSON.stringify(host)}) return "host-mismatch";
    window.__persephoneSiteRuntime?.dispose?.();
    delete window.__persephoneSiteExtension;
    return "ok";
})()`;
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
        await siteExtensionTrust.load().catch((): undefined => undefined);
        if (isPrivateBrowserSession(this.model.state.get())) return;
        const webview = this.model.webview.get(tabId);
        if (!webview) return;
        let pageUrl: URL;
        try { pageUrl = new URL(webview.getURL()); } catch { return; }
        if (pageUrl.protocol !== "https:") return;
        const documentId = this.documentId(tabId);
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
        const webview = this.model.webview.get(tabId);
        if (!webview || isPrivateBrowserSession(this.model.state.get())) return { status: "not-current" };
        let pageUrl: URL;
        try { pageUrl = new URL(webview.getURL()); } catch { return { status: "not-current" }; }
        const isAllowed = (): boolean => !isPrivateBrowserSession(this.model.state.get())
            && siteExtensionTrust.isGranted(extension) && extension.hosts.includes(pageUrl.hostname)
            && this.currentDocument(tabId, documentId, pageUrl.hostname);
        if (pageUrl.protocol !== "https:" || !isAllowed()) return { status: "not-current" };
        let expression: string;
        try {
            const [source, runtime] = await Promise.all([fs.read(extension.scriptPath), api.getSiteExtensionRuntime()]);
            if (!isAllowed()) return { status: "not-current" };
            expression = `(() => {
    const host = ${JSON.stringify(pageUrl.hostname)};
    if (location.protocol !== "https:" || location.hostname !== host) return "host-mismatch";
    if (window.__persephoneSiteExtension) return "already-injected";
    Object.defineProperty(window, "__persephoneSiteExtension", {
        value: { id: ${JSON.stringify(extension.id)}, host }, enumerable: false, configurable: true,
    });
${runtime}
    try {
${source}
    } catch (error) {
        console.error("[site-extension] " + ${JSON.stringify(extension.id)} + ":", error);
        let message = "Unknown page error";
        try { message = error && typeof error === "object" && typeof error.message === "string" ? error.message : String(error); }
        catch { /* retain the safe fallback */ }
        return "extension-error:" + message;
    }
    return "ok";
})()`;
        } catch (error) {
            console.warn(`[site-extension] ${extension.id}: extension files could not be read`);
            return { status: "extension-error", error: boundExtensionError(`Extension files could not be read: ${errMessage(error, "read failed")}`) };
        }
        if (!isAllowed()) return { status: "not-current" };
        let result: unknown;
        let actionDocument: SiteActionDocument | undefined;
        const clearOwnActions = (): void => {
            if (actionDocument && this.actionDocuments.get(tabId) === actionDocument) this.clear(tabId);
        };
        try {
            const cdp = this.model.target.cdp(tabId);
            if (!await cdp.attach({ aiVisionBinding: true })) {
                console.warn(`[site-extension] ${extension.id}: CDP attach failed`);
                return { status: "not-current" };
            }
            if (!isAllowed()) return { status: "not-current" };
            await ensureTargetReady(this.model.target, tabId);
            if (!isAllowed()) return { status: "not-current" };
            const existing = this.actionDocuments.get(tabId);
            if (existing && existing.isCurrent(false)) return existing.injected ? { status: "injected" } : { status: "not-current" };
            this.clear(tabId);
            actionDocument = new SiteActionDocument(this.model, tabId, documentId, pageUrl.hostname, extension.id,
                [...extension.hosts], [...extension.fetchHosts], this.model.target,
                () => this.currentDocument(tabId, documentId, pageUrl.hostname));
            this.actionDocuments.set(tabId, actionDocument);
            result = await evaluateInTarget(this.model.target, expression, tabId);
        } catch (error) {
            clearOwnActions();
            console.warn(`[site-extension] ${extension.id}: ${errMessage(error, "injection failed").slice(0, 256)}`);
            return { status: "extension-error", error: boundExtensionError(`Extension evaluation failed: ${errMessage(error, "injection failed")}`) };
        }
        if (!isAllowed() || this.actionDocuments.get(tabId) !== actionDocument) { clearOwnActions(); return { status: "not-current" }; }
        const detail = String(result);
        if (detail !== "ok") clearOwnActions();
        if (detail.startsWith("extension-error:")) {
            console.warn(`[site-extension] ${extension.id}: extension script failed`);
            return { status: "extension-error", error: pageExtensionError(detail.slice("extension-error:".length)) };
        }
        if (detail === "host-mismatch" || detail === "already-injected") return { status: "not-current" };
        if (detail !== "ok") return { status: "extension-error", error: boundExtensionError("Extension evaluation returned an unexpected result.") };
        const actions = this.actionDocuments.get(tabId);
        if (actions && actions.isCurrent(false)) {
            actions.injected = true;
            this.model.pageRemote.notifyChanged();
        }
        this.setMarker(tabId, documentId, extension.name);
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
                void api.cancelSiteExtensionFetches(doc.fetchKey).catch((): undefined => undefined);
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
