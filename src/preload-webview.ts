import { installPageTranslationAgent } from "./preload-webview/page-translation-agent";
import { installCinemaMode } from "./preload-webview/cinema-mode";
import { installChromeShim } from "./preload-webview/chrome-shim";
import { installWebMcpBridge } from "./preload-webview/webmcp-bridge";
import { installPageReporters } from "./preload-webview/page-reporters";
import { installExclusiveAccessReporter } from "./preload-webview/exclusive-access-reporter";
import { installPageVisibilityShim } from "./preload-webview/page-visibility-shim";

installPageTranslationAgent();
installCinemaMode();
installExclusiveAccessReporter();
installPageVisibilityShim();

if (process.isMainFrame) {
    installChromeShim();
    installWebMcpBridge();
    installPageReporters();
}
