import { TComponentModel } from "../../../core/state/model";
import { toClipboard } from "../../../core/utils/utils";
import { api } from "../../../../ipc/renderer/api";
import rendererEvents from "../../../../ipc/renderer/renderer-events";

export interface McpSectionProps {
    agentTipsEnabled: boolean;
    mcpEnabled: boolean;
    mcpPort: number;
    mainScriptsEnabled: boolean;
    mnemeEnabled: boolean;
    mnemePort: number;
}

const defaultMcpSectionState = {
    status: null as { running: boolean; url: string; clientCount: number } | null,
    mnemeStatus: null as { running: boolean; url: string } | null,
    copied: null as string | null,
};

export type McpSectionState = typeof defaultMcpSectionState;

/** Coordinates server status subscriptions and copied-label state. */
export class McpSectionModel extends TComponentModel<McpSectionState, McpSectionProps> {
    private copiedTimer: ReturnType<typeof setTimeout> | undefined;
    private initialized = false;
    private lastMcpEnabled = false;
    private lastMnemeEnabled = false;
    private mcpStatusDisposer: (() => void) | undefined;
    private mnemeStatusDisposer: (() => void) | undefined;

    init(): void {
        this.subscribeMcpStatus();
        this.subscribeMnemeStatus();
        this.own(() => {
            this.stopMcpStatus();
            this.stopMnemeStatus();
        });
        this.lastMcpEnabled = this.props.mcpEnabled;
        this.lastMnemeEnabled = this.props.mnemeEnabled;
        this.initialized = true;
    }

    setProps = (props: McpSectionProps): void => {
        if (!this.initialized) return;
        if (props.mcpEnabled !== this.lastMcpEnabled) {
            this.lastMcpEnabled = props.mcpEnabled;
            this.stopMcpStatus();
            this.subscribeMcpStatus();
        }
        if (props.mnemeEnabled !== this.lastMnemeEnabled) {
            this.lastMnemeEnabled = props.mnemeEnabled;
            this.stopMnemeStatus();
            this.subscribeMnemeStatus();
        }
    };

    private subscribeMcpStatus = (): void => {
        void api.getMcpStatus().then((status) => {
            if (this.isLive) this.state.update((state) => { state.status = status; });
        }).catch(() => {
            if (this.isLive) this.state.update((state) => { state.status = null; });
        });
        const subscription = rendererEvents.eMcpStatusChanged.subscribe((status) => {
            if (this.isLive) this.state.update((state) => { state.status = status; });
        });
        this.mcpStatusDisposer = subscription;
    };

    private subscribeMnemeStatus = (): void => {
        void api.getMnemeStatus().then((status) => {
            if (this.isLive) this.state.update((state) => { state.mnemeStatus = status; });
        }).catch(() => {
            if (this.isLive) this.state.update((state) => { state.mnemeStatus = null; });
        });
        const subscription = rendererEvents.eMnemeStatusChanged.subscribe((status) => {
            if (this.isLive) this.state.update((state) => { state.mnemeStatus = status; });
        });
        this.mnemeStatusDisposer = subscription;
    };

    private stopMcpStatus = (): void => {
        const disposer = this.mcpStatusDisposer;
        this.mcpStatusDisposer = undefined;
        disposer?.();
    };

    private stopMnemeStatus = (): void => {
        const disposer = this.mnemeStatusDisposer;
        this.mnemeStatusDisposer = undefined;
        disposer?.();
    };

    handleCopy = (text: string, label: string) => {
        toClipboard(text);
        this.state.update((state) => { state.copied = label; });
        if (this.copiedTimer !== undefined) clearTimeout(this.copiedTimer);
        this.copiedTimer = setTimeout(() => {
            this.copiedTimer = undefined;
            if (this.isLive) this.state.update((state) => {
                if (state.copied === label) state.copied = null;
            });
        }, 2000);
    };

    dispose() {
        this.stopMcpStatus();
        this.stopMnemeStatus();
        if (this.copiedTimer !== undefined) clearTimeout(this.copiedTimer);
        this.copiedTimer = undefined;
    }
}

export { defaultMcpSectionState };
