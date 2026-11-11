/**
 * Board bridge shim — runs as a browser-only IIFE inside the board iframe.
 * It is injected into the document head before author scripts, so the public API
 * and all host/port listeners are installed synchronously.
 */
import { BOARD_BRIDGE_VERSION } from "./shared/board-bridge-version";
import type { BoardBootContext } from "./ipc/board-bridge/boot";
import type { BoardPortInitMsg } from "./ipc/board-bridge/frame-protocol";
import { HostFrameChannel } from "./board-shim/board-host-frame-channel";
import { MainPortChannel } from "./board-shim/main-port-channel";
import { ServicePortInbox } from "./board-shim/service-port-inbox";
import { SettledValue, composeApi } from "./board-shim/primitives";
import { installBoardDialogs } from "./board-shim/dialogs";
import { installFrameBehaviours } from "./board-shim/frame-behaviours";
import { createSourceApi } from "./board-shim/source-api";
import { createPageApi } from "./board-shim/page-api";
import { createHostContentApi } from "./board-shim/host-content-api";
import { createSharedStateApi } from "./board-shim/shared-state-api";
import { createChromeApi } from "./board-shim/chrome-api";
import { createSettingsApi } from "./board-shim/settings-api";
import { createIconsApi } from "./board-shim/icons-api";
import { createThemesApi } from "./board-shim/themes-api";
import { createI18nApi } from "./board-shim/i18n-api";
import { createFilesApi } from "./board-shim/files-api";
import { createFetchApi } from "./board-shim/fetch-api";
import { createServiceApi } from "./board-shim/service-api";
import { createCapabilityApi } from "./board-shim/capability-api";
import { createAiVisionApi } from "./board-shim/ai-vision-api";
import { createStorageApi } from "./board-shim/storage-api";
import { createExecuteApi } from "./board-shim/execute-api";
import { createBridgeActionsApi } from "./board-shim/bridge-actions-api";

const boot: BoardBootContext =
    (window as unknown as { __persephoneBoot?: BoardBootContext }).__persephoneBoot ?? {
        theme: { id: "", isDark: true, vars: {} },
        tokens: {},
        i18n: { locale: { code: "en" }, tables: [{}, {}, {}] },
        hostText: {} as BoardBootContext["hostText"],
        hostOrigin: "",
    };

// File origins are opaque in Chromium, so strict origin checks apply only to HTTP(S) hosts.
const hostOriginStrict = /^https?:\/\//i.test(boot.hostOrigin);
const hostPostTarget = hostOriginStrict ? boot.hostOrigin : "*";
let hostRequestId = Math.floor(Math.random() * 0x80000000);
const hostFrame = new HostFrameChannel({
    targetOrigin: hostPostTarget,
    acceptOrigin: hostOriginStrict ? boot.hostOrigin : undefined,
    nextId: () => ++hostRequestId,
});

let viewRole = "main";
try {
    const view = new URLSearchParams(location.search).get("view");
    if (view) viewRole = view;
} catch {
    // location unavailable — keep the main view role
}

const handshake = new SettledValue<void>();
const whenHandshake = () => handshake.get();
const mainPort = new MainPortChannel();
const servicePortInbox = new ServicePortInbox();

const source = createSourceApi({ hostFrame, whenHandshake });
const page = createPageApi({ hostFrame });
const hostContent = createHostContentApi({ hostFrame, whenHandshake });
const sharedState = createSharedStateApi({ hostFrame });
const chrome = createChromeApi({ hostFrame, view: viewRole });
const settings = createSettingsApi({ hostFrame });
const icons = createIconsApi({ hostFrame });
const themes = createThemesApi({ mainPort, boot, invalidateIcons: icons.invalidate });
const i18n = createI18nApi({ boot });

const files = createFilesApi({ mainPort });
const fetchApi = createFetchApi({ hostFrame, mainPort });
const service = createServiceApi({ mainPort, hostFrame, servicePortInbox });
const capability = createCapabilityApi({ mainPort, hostFrame, waitForServiceChannel: service.waitForServiceChannel });
const aiVision = createAiVisionApi({ hostFrame, view: viewRole });
const storage = createStorageApi({ mainPort, hostFrame });
const execute = createExecuteApi({ mainPort });
const actions = createBridgeActionsApi({ mainPort, hostFrame });

const coreFragment = { version: BOARD_BRIDGE_VERSION };

hostFrame.onInit((data: BoardPortInitMsg, ports) => {
    page.initBusy(data);
    source.initFilePath(data);
    source.initSourceUrl(data);
    page.initVisibilityAndVoice(data);
    hostContent.init(data);
    capability.init(data);
    if (ports[0]) mainPort.replace(ports[0]);
    handshake.settle(undefined);
});

window.addEventListener("pagehide", () => {
    service.closeActiveChannels();
    servicePortInbox.dispose();
    mainPort.dispose();
});

installBoardDialogs();
installFrameBehaviours({ hostFrame, mainPort, hostText: i18n.hostText, openRawLink: actions.openRawLink });
(window as unknown as { persephone: unknown }).persephone = composeApi(
    coreFragment,
    page.api,
    source.api,
    hostContent.api,
    sharedState.api,
    chrome.api,
    settings.api,
    themes.api,
    i18n.api,
    files.api,
    fetchApi.api,
    service.api,
    capability.api,
    aiVision.api,
    storage.api,
    execute.api,
    icons.api,
    actions.api,
);
hostFrame.listen();
