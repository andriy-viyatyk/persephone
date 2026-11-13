import {
    BrowserChannel,
    type BrowserEvent,
    type BrowserRegisterRequest,
    type BrowserSitePermissionKey,
    type BrowserSitePermissions,
    type NetworkLogEntry,
} from "../../../ipc/browser-ipc";
const { ipcRenderer } = require("electron");

/** Owns the renderer IPC surface and registration keys for one browser editor. */
export class BrowserGuestChannel {
    constructor(private readonly editorId: string) {}

    key(tabId: string): string {
        return `${this.editorId}/${tabId}`;
    }

    register(request: BrowserRegisterRequest): void { ipcRenderer.send(BrowserChannel.register, request); }
    unregister(tabId: string): void { ipcRenderer.send(BrowserChannel.unregister, this.key(tabId)); }
    setMuted(tabId: string, muted: boolean): void { ipcRenderer.send(BrowserChannel.setAudioMuted, this.key(tabId), muted); }
    setZoom(tabId: string, zoomPercent: number): Promise<void> {
        return ipcRenderer.invoke(BrowserChannel.setZoom, { registrationKey: this.key(tabId), zoomPercent });
    }
    hardReload(tabId: string): void { ipcRenderer.send(BrowserChannel.hardReload, this.key(tabId)); }
    exitHtmlFullscreen(tabId: string): void { ipcRenderer.send(BrowserChannel.exitHtmlFullscreen, this.key(tabId)); }
    clearCache(partition: string): Promise<void> { return ipcRenderer.invoke(BrowserChannel.clearCache, partition); }
    allowPopups(): void { ipcRenderer.send(BrowserChannel.allowPopups); }
    collectDom(tabId: string): Promise<string> { return ipcRenderer.invoke(BrowserChannel.collectDom, this.key(tabId)); }
    collectLoadedResources(tabId: string): Promise<string[]> {
        return ipcRenderer.invoke(BrowserChannel.collectLoadedResources, this.key(tabId));
    }
    networkLog(tabId: string): Promise<NetworkLogEntry[]> { return ipcRenderer.invoke(BrowserChannel.getNetworkLog, this.key(tabId)); }
    getSitePermissions(registrationKey: string): Promise<BrowserSitePermissions> {
        return ipcRenderer.invoke(BrowserChannel.getSitePermissions, { registrationKey });
    }
    setSitePermission(registrationKey: string, key: BrowserSitePermissionKey, decision: "allow" | "block"): Promise<boolean> {
        return ipcRenderer.invoke(BrowserChannel.setSitePermission, { registrationKey, key, decision });
    }
    resetSitePermissions(registrationKey: string): Promise<boolean> {
        return ipcRenderer.invoke(BrowserChannel.resetSitePermissions, { registrationKey });
    }
    resolvePermissionRequest(requestId: string, decision: "allow" | "block"): void {
        void ipcRenderer.invoke(BrowserChannel.resolvePermissionRequest, { requestId, decision });
    }
    fullscreen(key: string, selector?: string): Promise<{ fullscreen: boolean }> {
        return ipcRenderer.invoke(BrowserChannel.fullscreen, { key, selector });
    }
    exitFullscreen(key: string): Promise<{ fullscreen: boolean }> {
        return ipcRenderer.invoke(BrowserChannel.exitFullscreen, { key });
    }
    onEvent(listener: (event: Electron.IpcRendererEvent, browserEvent: BrowserEvent) => void): () => void {
        ipcRenderer.on(BrowserChannel.event, listener);
        return () => ipcRenderer.removeListener(BrowserChannel.event, listener);
    }
}
