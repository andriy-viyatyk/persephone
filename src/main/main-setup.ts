/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { app, components } from "electron";
import { controller } from "../ipc/main/controller";
import { SERVICE_QUIT_GATE_TIMEOUT_MS } from "../ipc/module-service-channels";
import { errMessage } from "../shared/utils";
import { moduleServiceSupervisor } from "./module-service-supervisor";
import { openWindows } from "./open-windows";
import { disposeMainServices, startMainServices } from "./main-services";
import { hasTestInstanceOptions, parseTestInstanceOptions, stripTestInstanceOptions } from "./test-mode/instance-options";
import { configureTestModeMcp, startTestModeMcp } from "./test-mode/mcp";
import { configureTestModeLog } from "./test-mode/TestModeLog";
import { installTestCertificateTrust } from "./test-mode/certificates";
import { installTestModeMediaCapture } from "./test-mode/media-capture";
import { redirectTestInstanceLocalAppData } from "./test-mode/local-app-data";
import { installClientCertificatePolicy } from "./client-certificate-policy";

export function setupMainProcess(): void {
    let testInstance: ReturnType<typeof parseTestInstanceOptions>["options"];
    try { testInstance = parseTestInstanceOptions(process.argv.slice(process.defaultApp ? 2 : 1)).options; }
    catch (error) { console.error(error); app.exit(1); return; }
    installTestModeMediaCapture();
    redirectTestInstanceLocalAppData();
    configureTestModeMcp(testInstance);
    configureTestModeLog(testInstance?.logDirectory);
    installTestCertificateTrust();
    void startMainServices("setup-before-certificate");

    installClientCertificatePolicy();

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
        try { await startTestModeMcp(); }
        catch (error: unknown) { console.error("Test MCP bind failed:", error); app.exit(1); }
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

    app.on("second-instance", (_event, commandLine, workingDirectory) => {
        if (hasTestInstanceOptions(commandLine)) return;
        openWindows.handleSecondInstance(stripTestInstanceOptions(commandLine), workingDirectory);
    });
}
