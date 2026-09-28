import type { BrowserNetwork, BrowserProxyProtocol } from "../../../../ipc/browser-network-ipc";
import { validateProxyEndpoint } from "../../../../ipc/browser-network-ipc";
import { InputView } from "../../../uikit/Input/InputView";
import type { InputProps } from "../../../uikit/Input/InputView";
import { SelectView } from "../../../uikit/Select/SelectView";
import type { SelectViewProps } from "../../../uikit/Select/SelectView";
import type { IListBoxItem } from "../../../uikit/ListBox/types";
import { VanillaView } from "../../../uikit/shared/vanilla-view";
import { panel, settingsFieldLabel, text } from "./settings-native";
import "../../../uikit/Input/Input.css";
import "../../../uikit/Select/Select.css";

type NetworkMode = "direct" | BrowserProxyProtocol;

const MODE_ITEMS: IListBoxItem[] = [
    { value: "direct", label: "Direct" },
    { value: "socks5", label: "SOCKS5 proxy" },
    { value: "http", label: "HTTP proxy" },
];

/** Prefilled when a proxy is first chosen: the local WSL VPN endpoint of the runbook. */
const DEFAULT_PROXY_HOST = "127.0.0.1";
const DEFAULT_PROXY_PORT = "1080";

export interface ProfileNetworkLineProps {
    network: BrowserNetwork | undefined;
    onChange: (network: BrowserNetwork) => void;
}

/**
 * One browser profile's network route (US-1557): Direct, or an unauthenticated
 * SOCKS5/HTTP proxy endpoint. Edits are persisted only once the endpoint is
 * valid; until then the saved route stays in force and the error is shown.
 */
export class ProfileNetworkLineView extends VanillaView<ProfileNetworkLineProps> {
    private readonly select: SelectView<IListBoxItem>;
    private readonly hostInput: InputView;
    private readonly portInput: InputView;
    private readonly endpoint: HTMLDivElement;
    private readonly error: HTMLSpanElement;
    private mode: NetworkMode = "direct";
    private host = DEFAULT_PROXY_HOST;
    private port = DEFAULT_PROXY_PORT;
    /** JSON of the network the draft was last loaded from, so re-renders keep typing. */
    private loadedKey = "";

    public constructor(props: ProfileNetworkLineProps) {
        super(props, panel({ direction: "column", gap: "xs", paddingTop: "xs", paddingRight: "md", paddingBottom: "sm", paddingLeft: "xxl" }));
        // Before `load`, which clears it.
        this.error = text("", { color: "error", size: "xs" });
        this.load(props.network);
        this.select = this.child(new SelectView(this.selectProps()));
        this.hostInput = this.child(new InputView(this.hostProps()));
        this.portInput = this.child(new InputView(this.portProps()));
        this.endpoint = panel({ direction: "row", align: "center", gap: "xs" }, this.hostInput.root, text(":", { color: "light" }), this.portInput.root);
        const line = panel({ direction: "row", align: "center", gap: "md" }, settingsFieldLabel("Network:"), panel({ width: 140 }, this.select.root), this.endpoint);
        this.root.append(line, this.error);
    }

    protected onMount(): void {
        this.select.mount();
        this.hostInput.mount();
        this.portInput.mount();
        this.sync();
    }

    protected onUpdate(props: ProfileNetworkLineProps): void {
        if (JSON.stringify(props.network ?? null) !== this.loadedKey) this.load(props.network);
        this.sync();
    }

    private load(network: BrowserNetwork | undefined): void {
        this.loadedKey = JSON.stringify(network ?? null);
        if (network?.kind === "proxy") {
            this.mode = network.protocol;
            this.host = network.host;
            this.port = String(network.port);
        } else {
            this.mode = "direct";
        }
        this.setError("");
    }

    private sync(): void {
        this.select.update(this.selectProps());
        this.hostInput.update(this.hostProps());
        this.portInput.update(this.portProps());
        this.endpoint.hidden = this.mode === "direct";
    }

    private commit(): void {
        if (this.mode === "direct") {
            this.setError("");
            this.emit({ kind: "direct" });
            return;
        }
        const host = this.host.trim();
        const port = Number(this.port.trim());
        const error = validateProxyEndpoint(host, port);
        this.setError(error ? `${error} Not saved.` : "");
        if (error) return;
        this.emit({ kind: "proxy", protocol: this.mode, host, port });
    }

    /** Persist only a real change — a blur without an edit must not rewrite settings. */
    private emit(network: BrowserNetwork): void {
        const saved = this.props.network?.kind === "proxy" ? this.props.network : { kind: "direct" };
        if (JSON.stringify(network) === JSON.stringify(saved)) return;
        this.props.onChange(network);
    }

    private setError(message: string): void {
        this.error.textContent = message;
        this.error.hidden = !message;
    }

    private selectProps(): SelectViewProps<IListBoxItem> {
        return {
            name: "profile-network-mode",
            size: "sm",
            items: MODE_ITEMS,
            value: MODE_ITEMS.find((item) => item.value === this.mode) ?? null,
            onChange: (item) => {
                this.mode = item.value as NetworkMode;
                this.sync();
                this.commit();
            },
        };
    }

    private hostProps(): InputProps {
        return {
            name: "profile-network-host", size: "sm", width: 130, type: "text", placeholder: "host",
            value: this.host,
            onChange: (value) => { this.host = value; },
            onBlur: () => this.commit(),
            onKeyDown: (event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); },
        };
    }

    private portProps(): InputProps {
        return {
            name: "profile-network-port", size: "sm", width: 56, type: "text", placeholder: "port",
            value: this.port,
            onChange: (value) => { this.port = value; },
            onBlur: () => this.commit(),
            onKeyDown: (event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); },
        };
    }
}
