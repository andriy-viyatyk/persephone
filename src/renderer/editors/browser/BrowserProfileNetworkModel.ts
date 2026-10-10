const { ipcRenderer } = require("electron");
import { settings } from "../../api/settings";
import type { BrowserProfile } from "../../api/settings";
import { ui } from "../../api/ui";
import { BrowserNetworkChannel, proxyLabel } from "../../../ipc/browser-network-ipc";
import type { BrowserNetwork, BrowserNetworkApplyResult } from "../../../ipc/browser-network-ipc";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { profileImageRoute, resolveRoutedSrc, torImageRoute } from "../link-editor/routed-src";
import type { ImageRoute } from "../link-editor/routed-src";
import { DisposableStore } from "../../core/utils/DisposableStore";
import type { BrowserEditorModel } from "./BrowserEditorModel";

/**
 * The saved network for a browser page: its profile ("" = the built-in default
 * profile), or the shared Incognito setting.
 *
 * A malformed proxy entry is passed through rather than read as direct: main
 * rejects it and the page refuses to load, which is the fail-closed outcome for
 * a profile the user meant to proxy.
 */
export function resolveProfileNetwork(profileName: string, isIncognito = false): BrowserNetwork {
    const network: BrowserNetwork | undefined = isIncognito
        ? settings.get("browser-incognito-network")
        : profileName
            ? settings.get("browser-profiles").find((p: BrowserProfile) => p.name === profileName)?.network
            : settings.get("browser-default-network");
    if (network?.kind !== "proxy") return { kind: "direct" };
    return { kind: "proxy", protocol: network.protocol, host: network.host, port: network.port };
}

/** An IPC rejection's message without Electron's "Error invoking remote method …" wrapper. */
function invokeErrorMessage(err: unknown): string {
    return errMessage(err).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}

/**
 * Owns one browser page's profile network (US-1557): applies the profile's
 * proxy to its session before the page mounts, re-applies it when the setting
 * changes, and exposes the route app-rendered content must use.
 *
 * Incognito pages use it too, with the shared Incognito setting; Tor pages have
 * their own route and never do.
 */
export class BrowserProfileNetworkModel {
    private readonly disposables = new DisposableStore();
    /** JSON of the network last applied, so unrelated settings edits do nothing. */
    private appliedKey: string | undefined;
    /** Set by the first `armProxy`; from then on the page follows settings edits. */
    private armed = false;
    private disposed = false;

    constructor(readonly model: BrowserEditorModel) {
        this.disposables.add(settings.onChanged.subscribe(({ key }) => {
            if (key !== "browser-profiles" && key !== "browser-default-network" && key !== "browser-incognito-network") return;
            // Only a page that has been armed follows edits (a failed one too, so
            // fixing the setting recovers it); one still being created arms itself
            // with the current value anyway.
            if (!this.armed) return;
            void this.armProxy().catch((err: unknown) => {
            ui.notify(t("browser.profileNetworkApplyFailed", { error: invokeErrorMessage(err) }), "error");
            });
        }));
    }

    private get applies(): boolean {
        const s = this.model.state.get();
        return !s.isTor;
    }

    /**
     * Put the profile session on its configured route. Must be awaited before
     * the page is added to the window. Rejects when main cannot apply the proxy;
     * the page must then not browse, since the session state is unknown.
     */
    armProxy = async (): Promise<void> => {
        if (this.disposed || !this.applies) return;
        this.armed = true;
        const { profileName, isIncognito } = this.model.state.get();
        const network = resolveProfileNetwork(profileName, isIncognito);
        const key = JSON.stringify(network);
        const previousKey = this.appliedKey;
        if (key === previousKey) return;
        this.appliedKey = key;
        let result: BrowserNetworkApplyResult;
        try {
            result = await ipcRenderer.invoke(BrowserNetworkChannel.apply, this.model.partition, network);
        } catch (err) {
            // Forget the attempt so a retry (or the next settings edit) tries again.
            if (this.appliedKey === key) this.appliedKey = undefined;
            this.model.state.update((s) => {
                s.networkError = invokeErrorMessage(err);
            });
            throw err;
        }
        if (this.disposed || this.appliedKey !== key) return;
        this.model.state.update((s) => {
            s.networkToken = result.token ?? "";
            s.networkLabel = network.kind === "proxy" ? proxyLabel(network) : "";
            s.networkError = "";
        });
        // A runtime change: new requests take the new route, but documents already
        // loaded stay as they are until reloaded.
        if (previousKey !== undefined && this.model.state.get().tabs.some((t) => t.url !== "about:blank")) {
            ui.notify(t("browser.profileNetworkChanged"), "info");
        }
    };

    /**
     * Route for app-rendered remote resources of this page: Tor, a proxied
     * profile, or null for direct. Read at render time.
     */
    get imageRoute(): ImageRoute | null {
        const s = this.model.state.get();
        if (s.isTor) return torImageRoute(this.model.partition, s.torStatus === "connected");
        return s.networkToken ? profileImageRoute(s.networkToken, s.isIncognito) : null;
    }

    /** Resolve a remote favicon/image URL for display in the host renderer. */
    routeSrc(src: string): string | null {
        return resolveRoutedSrc(src, this.imageRoute);
    }

    /**
     * For a download the host renderer makes itself (the favicon cache): the
     * routed URL to fetch, `undefined` for a direct page (fetch the URL as-is),
     * or `null` when it must not be fetched now (route not up).
     */
    routedFetchUrl(src: string): string | null | undefined {
        const route = this.imageRoute;
        return route ? resolveRoutedSrc(src, route) : undefined;
    }

    /**
     * A `session-src` handle so a resource opened out of this page is fetched
     * through its session: `undefined` for a direct page or a non-network URL
     * (open it as-is), `null` when the page is routed but its route is not up —
     * the caller must then not open it at all.
     */
    async sessionSource(url: string): Promise<string | null | undefined> {
        if (!this.imageRoute || !/^https?:/i.test(url)) return undefined;
        const handle: string | undefined = await ipcRenderer.invoke(
            BrowserNetworkChannel.sessionSource, this.model.partition, url,
        );
        return handle ?? null;
    }

    /** Open the network info dialog (egress IP, location). */
    showInfoDialog = async (): Promise<void> => {
        const { showBrowserNetworkInfoDialog } = await import("../../ui/dialogs/TorInfoDialog");
        await showBrowserNetworkInfoDialog(this.model.partition, this.model.state.get().networkLabel);
    };

    dispose = () => {
        // An Incognito page's session is its own; tell main to forget it. A
        // profile's session is shared with other pages and stays applied.
        if (this.armed && this.model.state.get().isIncognito) {
            void ipcRenderer.invoke(BrowserNetworkChannel.release, this.model.partition);
        }
        this.disposed = true;
        this.disposables.dispose();
    };
}
