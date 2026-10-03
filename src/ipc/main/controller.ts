import { initBoardHandlers } from "./board-handlers";
import { initBoardPipeHandlers } from "./board-pipe-handlers";
import { initCoreHandlers } from "./core-handlers";
import { initGitHandlers } from "./git-handlers";
import { initRendererEvents } from "./renderer-events";
import { initSiteExtensionHandlers } from "./site-extension-handlers";

/** Main IPC composition root. Service registrars own their endpoint implementations. */
const init = (): void => {
    initCoreHandlers();
    initGitHandlers();
    initBoardHandlers();
    initBoardPipeHandlers();
    initSiteExtensionHandlers();
    initRendererEvents();
};

export const controller = { init };
