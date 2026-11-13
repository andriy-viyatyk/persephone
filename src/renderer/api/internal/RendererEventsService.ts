import rendererEvents from "../../../ipc/renderer/renderer-events";
import { pages } from "../pages";
import { app } from "../app";
import { createLinkData } from "../../../shared/link-data";
import { appWindow, signalReadyToQuit } from "../window";
import { ui } from "../ui";
import { guard } from "../../core/utils/guard";
import { isBoardClaimedScheme, schemeOf } from "../../content/scheme-registry";
import { boardEditorId } from "../boards/custom-editor-registry";
import type { EventPayload } from "../../../ipc/event-types";
import type { LaunchInput } from "../../../shared/launch-input";
import { saveWindowStateForShutdown } from "./save-window-state";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";

/**
 * Renderer IPC events service.
 * Subscribes to IPC events and delegates to pages methods.
 * Will be updated in to delegate to app.pages instead.
 */
export class RendererEventsService {
    async init(): Promise<void> {
        // App.initEvents() owns these process-lifetime IPC subscriptions; no view/model
        // owns the application event bus wiring.
        // Page operations (currently delegates to pages)
        rendererEvents.eOpenFile.subscribe((filePath) =>
            this.openLaunchInput({ kind: "file", path: filePath }),
        );
        rendererEvents.eOpenDiff.subscribe((params) =>
            this.openLaunchInput({ kind: "diff", ...params }),
        );
        rendererEvents.eShowPage.subscribe(this.handleShowPage);
        rendererEvents.eMovePageIn.subscribe(this.handleMovePageIn);
        rendererEvents.eMovePageOut.subscribe(this.handleMovePageOut);

        // URL opening
        rendererEvents.eOpenUrl.subscribe(this.handleOpenUrl);
        rendererEvents.eOpenPipelineCandidate.subscribe(this.handlePipelineCandidate);
        rendererEvents.eOpenClaimedBrowserDownload.subscribe(this.handleClaimedBrowserDownload);
        rendererEvents.eOpenExternalUrl.subscribe((url) =>
            this.openLaunchInput({ kind: "url", url }),
        );

        // Quit handler
        rendererEvents.eBeforeQuit.subscribe(this.handleBeforeQuit);
        rendererEvents.eReloadForLanguage.subscribe(this.handleReloadForLanguage);

        // Update check notification
        rendererEvents["eUpdateAvailable"].subscribe(this.handleUpdateAvailable);

        // Board `persephone.notify()` toast.
        rendererEvents["eBoardNotify"].subscribe(this.handleBoardNotify);

    }

    openLaunchInput = async (input: LaunchInput): Promise<void> => {
        switch (input.kind) {
            case "file":
                await guard(t("api.failedToOpenFile"), () =>
                    app.events.openRawLink.sendAsync(createLinkData(input.path)),
                );
                return;
            case "url":
                // Route through the pipeline — the HTTP resolver decides content vs browser.
                // `browserMode: "internal"` prevents the shell.openExternal fallback, which
                // would loop back to us when Persephone is the OS default browser.
                await guard(t("api.failedToOpenUrl"), () =>
                    app.events.openRawLink.sendAsync(
                        createLinkData(input.url, { browserMode: "internal" }),
                    ),
                );
                return;
            case "diff":
                await guard(t("api.failedToOpenDiff"), () =>
                    pages.lifecycle.openDiff({
                        firstPath: input.firstPath,
                        secondPath: input.secondPath,
                    }),
                );
        }
    };

    private handleShowPage = async (pageId: EventPayload<"eShowPage">) => {
        await guard(t("api.failedToShowPage"), () => pages.navigation.showPage(pageId));
    };

    private handleMovePageIn = async (data: EventPayload<"eMovePageIn">) => {
        await guard(t("api.failedToMovePage"), () => pages.lifecycle.movePageIn(data));
    };

    private handleMovePageOut = async (pageId: EventPayload<"eMovePageOut">) => {
        await guard(t("api.failedToMovePage"), () => pages.lifecycle.movePageOut(pageId));
    };

    private handleOpenUrl = async (event: EventPayload<"eOpenUrl">) => {
        await guard(t("api.failedToOpenUrl"), () =>
            app.events.openRawLink.sendAsync(createLinkData(event.url, {
                ...(event.boardRoot ? { boardRoot: event.boardRoot, sourceId: "board" } : {}),
                ...(event.unattributedPopup ? { unattributedPopup: true } : {}),
            })),
        );
    };

    private handlePipelineCandidate = async (url: EventPayload<"eOpenPipelineCandidate">) => {
        const scheme = schemeOf(url);
        if (!scheme || !isBoardClaimedScheme(scheme)) return;

        await guard(t("api.failedToOpenUrl"), () =>
            app.events.openRawLink.sendAsync(createLinkData(url)),
        );
    };

    private handleClaimedBrowserDownload = async (data: EventPayload<"eOpenClaimedBrowserDownload">) => {
        await guard(t("api.failedToOpenUrl"), () =>
            app.events.openRawLink.sendAsync(
                createLinkData(data.url, {
                    target: boardEditorId(data.boardRoot),
                    sessionHandle: data.sessionHandle,
                }),
            ),
        );
    };

    private handleBeforeQuit = async () => {
        if (appWindow.isBoardMode) {
            const nonRightPages = pages.state.get().pages.filter((page) => page.pinSide !== "right");
            // A save prompt waits for the user; without this, main's 2-second unresponsive-renderer
            // timer destroys the window while the dialog is still open.
            if (nonRightPages.some((page) => page.needsReleaseConfirmation)) appWindow.resolveWindowClose("prompting");
            for (const page of nonRightPages) {
                if (!(await page.confirmRelease())) {
                    appWindow.resolveWindowClose("cancel");
                    return;
                }
            }
            try {
                await saveWindowStateForShutdown();
            } catch (err) {
                console.error("Failed to prepare board window close:", errMessage(err));
            }
            appWindow.resolveWindowClose("close");
            return;
        }
        try {
            await saveWindowStateForShutdown();
        } catch (err) {
            console.error("Failed to save pages on quit:", errMessage(err));
        }
        signalReadyToQuit();
    };

    private handleReloadForLanguage = async () => {
        try {
            await saveWindowStateForShutdown();
            window.location.reload();
        } catch (err: unknown) {
            console.error("Failed to save pages before language reload:", errMessage(err));
        }
    };

    private handleBoardNotify = (data: EventPayload<"eBoardNotify">) => {
        void ui.notify(data.message, data.type ?? "info", { persistent: data.persistent === true });
    };

    private handleUpdateAvailable = async (result: EventPayload<"eUpdateAvailable">) => {
        if (result.updateAvailable && result.releaseInfo) {
            const closeResult = await ui.notify(
                t("api.updateAvailable", { version: result.releaseInfo.version }),
                "info",
            );
            if (closeResult === "clicked") {
                pages.standalonePages.show("about-page").then((): undefined => undefined);
            }
        }
    };
}
