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

/**
 * A SIGTERM sent to the whole process group (`systemctl stop`, session logout, `pkill`) kills the
 * GPU process and the zygote while the quit flow below is still running. Chromium then relaunches
 * the GPU process, every launch fails, it runs out of fallback modes and aborts the browser with
 * "GPU process isn't usable. Goodbye." (SIGILL core dump, US-2242). Lifting the crash limit once
 * quitting has started stops that abort; Chromium reads the switch at crash time. It stays off
 * while running, where the limit is what moves a broken GPU driver to software rendering.
 */
function liftGpuCrashLimitForQuit(): void {
    if (app.commandLine.hasSwitch("disable-gpu-process-crash-limit")) return;
    app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
}

export function setupMainProcess(): void {
    app.on("before-quit", () => {
        openWindows.doQuit = true;
        liftGpuCrashLimitForQuit();
    });
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
