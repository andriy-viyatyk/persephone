import { TDialogModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";
import { TorChannel, type TorIpInfo } from "../../../ipc/tor-ipc";
import { BrowserNetworkChannel } from "../../../ipc/browser-network-ipc";
import { showDialog } from "./Dialogs";
import { registerDialogView } from "./dialog-view-registry";
import { TorInfoDialogView } from "./TorInfoDialogView";

const { ipcRenderer } = require("electron");

export const torInfoDialogId = Symbol("torInfoDialog");

/**
 * Egress info for a routed browser page: a Tor page (exit IP, Tor verdict,
 * Reconnect) or a proxied profile page (US-1557 — egress IP and location only).
 */
export interface TorInfoDialogState {
    mode: "tor" | "proxy";
    /** Proxy mode: the endpoint, e.g. "SOCKS5 127.0.0.1:1080". */
    proxyLabel: string;
    partition: string;
    loading: boolean;
    reconnecting: boolean;
    info: TorIpInfo | null;
    note: string;
}

export class TorInfoDialogModel extends TDialogModel<TorInfoDialogState, void> {
    private viewDisposed = false;

    postCreate = () => {
        void this.load();
    };

    private load = async (): Promise<string> => {
        if (this.viewDisposed) return "";
        this.state.update((state) => { state.loading = true; });
        const { mode, partition } = this.state.get();
        const info: TorIpInfo = mode === "tor"
            ? await ipcRenderer.invoke(TorChannel.checkIp, partition)
            // A proxy has no Tor verdict; `isTor: null` keeps one state shape for the view.
            : { isTor: null, ...await ipcRenderer.invoke(BrowserNetworkChannel.checkIp, partition) };
        if (this.viewDisposed) return "";
        this.state.update((state) => {
            state.info = info;
            state.loading = false;
        });
        return info.ip;
    };

    reconnect = async () => {
        const state = this.state.get();
        if (this.viewDisposed || state.mode !== "tor" || state.reconnecting || state.loading) return;

        const previousIp = state.info?.ip ?? "";
        this.state.update((draft) => {
            draft.reconnecting = true;
            draft.note = "";
        });

        const result: { success: boolean; error?: string } = await ipcRenderer.invoke(
            TorChannel.restart,
            state.partition,
        );
        if (this.viewDisposed) return;

        if (!result.success) {
            this.state.update((draft) => {
                draft.reconnecting = false;
                draft.note = result.error || "Reconnect failed.";
            });
            return;
        }

        const newIp = await this.load();
        if (this.viewDisposed) return;
        this.state.update((draft) => {
            draft.reconnecting = false;
            if (!newIp) {
                draft.note = "Reconnected, but the exit IP could not be looked up.";
            } else if (newIp === previousIp) {
                draft.note = "Tor selected the same exit node \u2014 click Reconnect again for a different one.";
            } else {
                draft.note = "Reconnected with a new exit node.";
            }
        });
    };

    disposeView = () => {
        this.viewDisposed = true;
    };
}

registerDialogView(torInfoDialogId, TorInfoDialogView);

export function showTorInfoDialog(partition: string) {
    return openInfoDialog("tor", partition, "");
}

/** Egress info for a proxied browser profile page (US-1557). */
export function showBrowserNetworkInfoDialog(partition: string, proxyLabel: string) {
    return openInfoDialog("proxy", partition, proxyLabel);
}

function openInfoDialog(mode: TorInfoDialogState["mode"], partition: string, proxyLabel: string) {
    const model = new TorInfoDialogModel(
        new TComponentState<TorInfoDialogState>({
            mode,
            proxyLabel,
            partition,
            loading: true,
            reconnecting: false,
            info: null,
            note: "",
        }),
    );
    const result = showDialog({
        viewId: torInfoDialogId,
        model,
    });
    model.postCreate?.();
    return result as Promise<void>;
}
