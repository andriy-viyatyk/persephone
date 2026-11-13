import { initAppHandlers } from "./app-handlers";
import { initAudioHandlers } from "./audio-handlers";
import { initBoardHandlers } from "./board-handlers";
import { initBoardPipeHandlers, initBoardPipeReplyHandler } from "./board-pipe-handlers";
import { initBoardDialogHandlers } from "./board-dialog-handlers";
import { initBrowserHandlers } from "./browser-handlers";
import { initBrowserNetworkHandlers } from "./browser-network-handlers";
import { initCdpHandlers } from "./cdp-handlers";
import { initCommandRunnerHandlers } from "./command-runner-handlers";
import { initGlobalMuteHandlers } from "./global-mute-handlers";
import { initNetworkLoggerHandlers } from "./network-logger-handlers";
import { initSearchHandlers } from "./search-handlers";
import { initTorHandlers } from "./tor-handlers";
import { initWorkerHandlers } from "./worker-handlers";
import { initCapabilityHandlers } from "./capability-handlers";
import { initClipboardHandlers } from "./clipboard-handlers";
import { initDownloadHandlers } from "./download-handlers";
import { initFilesHandlers } from "./files-handlers";
import { initGitHandlers } from "./git-handlers";
import { initMcpMnemeHandlers } from "./mcp-mneme-handlers";
import { initMediaHandlers } from "./media-handlers";
import { initModuleServiceHandlers } from "./module-service-handlers";
import { initModuleServiceSettingsHandlers } from "./module-service-settings-handlers";
import { initPathWatchHandlers } from "./path-watch-handlers";
import { initRecordingHandlers } from "./recording-handlers";
import { initRendererEvents } from "./renderer-events";
import { initShellHandlers } from "./shell-handlers";
import { initSiteExtensionsHandlers } from "./site-extension-handlers";
import { initVoiceTypingHandlers } from "./voice-typing-handlers";
import { initWindowHandlers } from "./window-handlers";

/** Main IPC composition root. Domain registrars bind their service owners. */
const init = (): void => {
    [
        initWindowHandlers,
        initAppHandlers,
        initFilesHandlers,
        initDownloadHandlers,
        initCapabilityHandlers,
        initMcpMnemeHandlers,
        initAudioHandlers,
        initBoardDialogHandlers,
        initBrowserHandlers,
        initBrowserNetworkHandlers,
        initCdpHandlers,
        initCommandRunnerHandlers,
        initGlobalMuteHandlers,
        initNetworkLoggerHandlers,
        initSearchHandlers,
        initTorHandlers,
        initWorkerHandlers,
        initClipboardHandlers,
        initRecordingHandlers,
        initMediaHandlers,
        initShellHandlers,
        initGitHandlers,
        initBoardHandlers,
        initBoardPipeHandlers,
        initBoardPipeReplyHandler,
        initModuleServiceHandlers,
        initModuleServiceSettingsHandlers,
        initVoiceTypingHandlers,
        initSiteExtensionsHandlers,
        initPathWatchHandlers,
        initRendererEvents,
    ].forEach(register => register());
};

export const controller = { init };
