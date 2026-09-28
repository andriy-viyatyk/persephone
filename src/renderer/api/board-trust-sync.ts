import { EventEndpoint } from "../../ipc/api-types";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { api } from "../../ipc/renderer/api";
import { errMessage } from "../../shared/utils";
import { settings } from "./settings";
import { boardTrust } from "./board-trust";

let initialized = false;

/** Install main trust broadcasts and push the renderer-owned bundled-board setting. */
export async function initBoardTrustSync(): Promise<void> {
    if (initialized) return;
    await settings.wait();
    rendererEvents[EventEndpoint.eBoardTrustChanged].subscribe((paths) => {
        boardTrust.applyAuthoritativePaths(paths);
    });
    const pushDisabledBoards = (ids: string[]): void => {
        void api.setDisabledBundledBoards(ids).catch((error: unknown) => {
            console.error(`Disabled bundled board setting sync failed: ${errMessage(error)}`);
        });
    };
    settings.onChanged.subscribe(({ key }) => {
        if (key === "disabled-bundled-boards") {
            pushDisabledBoards(settings.get("disabled-bundled-boards"));
        }
    });
    await api.setDisabledBundledBoards(settings.get("disabled-bundled-boards"));
    await boardTrust.load();
    initialized = true;
}
