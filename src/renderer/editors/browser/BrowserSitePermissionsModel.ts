import type { BrowserSitePermissionKey, BrowserSitePermissions } from "../../../ipc/browser-ipc";
import { TComponentState } from "../../core/state/state";
import { capabilities } from "../../api/capabilities/CapabilitiesClient";
import { certificatesToPem } from "../../api/certificate-view";
import { ui } from "../../api/ui";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import type { BrowserEditor } from "./BrowserEditor";

interface BrowserSitePermissionsState {
    open: boolean;
    origin: string;
    permissions: BrowserSitePermissions;
    changed: boolean;
    certificateAvailable: boolean;
    sourceTabId: string;
    sourceUrl: string;
    certificateBusy: boolean;
}

const initialState = (): BrowserSitePermissionsState => ({
    open: false,
    origin: "",
    permissions: { origin: "", entries: [] },
    changed: false,
    certificateAvailable: false,
    sourceTabId: "",
    sourceUrl: "",
    certificateBusy: false,
});

/** Owns per-origin browser permissions and certificate presentation actions. */
export class BrowserSitePermissionsModel {
    readonly state = new TComponentState(initialState());
    private registrationKey = "";
    private loadGeneration = 0;

    constructor(private readonly editor: BrowserEditor) {}

    syncPage = (activeTabId: string, activeUrl: string, canOpen: boolean): void => {
        const registrationKey = this.editor.guest.key(activeTabId);
        let origin = "";
        try {
            const url = new URL(activeUrl);
            if (url.protocol === "http:" || url.protocol === "https:") origin = url.origin;
        } catch { /* Non-web URL: no site-permissions control. */ }
        if (registrationKey !== this.registrationKey || origin !== this.state.get().origin) {
            this.registrationKey = registrationKey;
            this.state.update((state) => {
                state.origin = origin;
                state.permissions = { origin, entries: [] };
                state.changed = false;
            });
            if (this.state.get().open && origin) void this.load();
        }
        if (!canOpen || !origin) this.close();
    };

    open = (tabId: string, url: string): void => {
        this.state.update((state) => {
            state.open = true;
            state.sourceTabId = tabId;
            state.sourceUrl = url;
            state.certificateAvailable = capabilities.handlers("certificate.view").length > 0;
        });
        void this.load();
    };

    close = (): void => {
        if (!this.state.get().open) return;
        this.state.update((state) => { state.open = false; });
    };

    load = async (): Promise<void> => {
        const generation = ++this.loadGeneration;
        const registrationKey = this.registrationKey;
        const origin = this.state.get().origin;
        try {
            const permissions = await this.editor.guest.getSitePermissions(registrationKey);
            if (generation !== this.loadGeneration || registrationKey !== this.registrationKey
                || origin !== this.state.get().origin || permissions.origin !== origin) return;
            this.state.update((state) => { state.permissions = permissions; });
        } catch { /* An unavailable webview simply has no permissions to display. */ }
    };

    set = async (key: BrowserSitePermissionKey, decision: "allow" | "block"): Promise<void> => {
        const registrationKey = this.registrationKey;
        const changed = await this.editor.guest.setSitePermission(registrationKey, key, decision);
        if (!changed || registrationKey !== this.registrationKey) return;
        this.state.update((state) => { state.changed = true; });
        await this.load();
    };

    reset = async (): Promise<void> => {
        const registrationKey = this.registrationKey;
        const reset = await this.editor.guest.resetSitePermissions(registrationKey);
        if (!reset || registrationKey !== this.registrationKey) return;
        this.state.update((state) => { state.changed = true; });
        await this.load();
    };

    getCertificate = async (
        internalTabId = this.editor.state.get().activeTabId,
    ): Promise<{ url: string; certificates: string[] } | undefined> => {
        const tab = this.editor.findTab(internalTabId);
        const currentUrl = tab?.url;
        if (!currentUrl || !URL.canParse(currentUrl)) return undefined;
        const url = new URL(currentUrl);
        if (url.protocol !== "https:") return undefined;
        await this.editor.target.ensureReady(internalTabId);
        const response = await this.editor.target.cdp(internalTabId).send(
            "Network.getCertificate", { origin: url.origin },
        ) as { tableNames?: unknown };
        if (!Array.isArray(response?.tableNames) || response.tableNames.length === 0
            || !response.tableNames.every((certificate: unknown) => typeof certificate === "string")) return undefined;
        return { url: currentUrl, certificates: response.tableNames };
    };

    viewCertificate = async (): Promise<void> => {
        if (this.state.get().certificateBusy) return;
        this.state.update((state) => { state.certificateBusy = true; });
        try {
            const { sourceTabId, sourceUrl, certificateAvailable } = this.state.get();
            const certificate = await this.getCertificate(sourceTabId);
            if (!certificate) {
                await ui.notify(t("browser.certificateUnavailable"), "warning");
                return;
            }
            if (!URL.canParse(sourceUrl) || new URL(sourceUrl).origin !== new URL(certificate.url).origin) {
                await ui.notify(t("browser.certificatePageChanged"), "warning");
                return;
            }
            const title = new URL(sourceUrl).hostname;
            if (certificateAvailable) {
                await capabilities.invoke("certificate.view", {
                    title, certificates: certificate.certificates, source: { url: certificate.url },
                }, { version: 1 });
            } else {
                await capabilities.invoke("text.open", {
                    content: certificatesToPem(certificate.certificates), language: "plaintext", title,
                });
            }
            this.close();
        } catch (error) {
            await ui.notify(t("browser.certificateViewFailed", { error: errMessage(error) }), "error");
        } finally {
            this.state.update((state) => { state.certificateBusy = false; });
        }
    };
}
