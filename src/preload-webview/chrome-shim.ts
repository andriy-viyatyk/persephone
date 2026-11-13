export function installChromeShim(): void {
    const { contextBridge } = require("electron");
try {
    contextBridge.executeInMainWorld({
        func: () => {
            const w = window as unknown as { chrome?: Record<string, unknown> };
            // Real Chrome (or an already-applied shim) — leave it alone.
            if (w.chrome && typeof w.chrome.loadTimes === "function") return;
            const chrome: Record<string, unknown> = w.chrome || {};
            const now = () => Date.now() / 1000;
            if (typeof chrome.loadTimes !== "function") {
                chrome.loadTimes = (): Record<string, unknown> => {
                    const t = now();
                    return {
                        requestTime: t, startLoadTime: t, commitLoadTime: t,
                        finishDocumentLoadTime: t, finishLoadTime: t, firstPaintTime: t,
                        firstPaintAfterLoadTime: 0, navigationType: "Other",
                        wasFetchedViaSpdy: true, wasNpnNegotiated: true,
                        npnNegotiatedProtocol: "h2", wasAlternateProtocolAvailable: false,
                        connectionInfo: "h2",
                    };
                };
            }
            if (typeof chrome.csi !== "function") {
                chrome.csi = (): Record<string, unknown> =>
                    ({ startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 });
            }
            if (!chrome.app) {
                chrome.app = {
                    isInstalled: false,
                    InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
                    RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
                    getDetails: (): null => null,
                    getIsInstalled: (): boolean => false,
                };
            }
            w.chrome = chrome;
        },
    });
} catch {
    // Older Electron without executeInMainWorld, or isolation disabled — no-op.
}

// WebMCP is enabled only for regular persistent browser profiles. The main process adds this
// argument before the guest starts; page-controlled state cannot enable the integration.
}
