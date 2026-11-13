/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { app, components } from "electron";
import { controller } from "../ipc/main/controller";
import { SERVICE_QUIT_GATE_TIMEOUT_MS } from "../ipc/module-service-channels";
import { errMessage } from "../shared/utils";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { openWindows } from "./open-windows";
import { disposeMainServices, startMainServices } from "./main-services";

export function setupMainProcess(): void {
    void startMainServices("setup-before-certificate");

    app.on("select-client-certificate", (event, webContents, _url, _list, callback) => {
        if (webContents === null) {
            event.preventDefault();
            callback();
        }
    });

    void startMainServices("setup-after-certificate-before-ipc");
    controller.init();
    void startMainServices("setup-after-ipc");

    app.on("ready", async () => {
        // Ensure Widevine CDM is available (Castlabs Electron downloads it automatically).
        try {
            await components.whenReady();
            console.log("Widevine CDM ready:", components.status());
        } catch (error: unknown) {
            console.warn("Widevine CDM initialization failed:", error);
        }

        await startMainServices("ready");
    });

    let serviceQuitGateStarted = false;
    let serviceQuitGateReleased = false;

    app.on("will-quit", (event) => {
        disposeMainServices("before-gate");
        if (!serviceQuitGateReleased) {
            event.preventDefault();
            if (!serviceQuitGateStarted) {
                serviceQuitGateStarted = true;
                void (async () => {
                    try {
                        const disposal = moduleServiceSupervisor.disposeAll().catch((error: unknown) => {
                            console.warn(`Module service disposal failed: ${errMessage(error)}`);
                        });
                        await Promise.race([
                            disposal,
                            new Promise<void>((resolve) => setTimeout(resolve, SERVICE_QUIT_GATE_TIMEOUT_MS)),
                        ]);
                    } finally {
                        // Re-enter Electron's quit flow even when disposal timed out or failed.
                        try {
                            moduleServiceSupervisor.forceKillAllSync();
                        } catch (error: unknown) {
                            console.warn(`Module service force-kill failed: ${errMessage(error)}`);
                        }
                        serviceQuitGateReleased = true;
                        app.quit();
                    }
                })();
            }
        }
        disposeMainServices("quit");
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });

    app.on("second-instance", (_event, commandLine, workingDirectory) => openWindows.handleSecondInstance(commandLine, workingDirectory));
}
