import rendererEvents from "../../../ipc/renderer/renderer-events";
import { pages } from "../pages";
import { app } from "../app";
import { createLinkData } from "../../../shared/link-data";
import { appWindow, signalReadyToQuit } from "../window";
import { ui } from "../ui";
import { guard } from "../../core/utils/guard";
import { boardEditorId } from "../../../shared/board/board-editor-id";
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
    private startupEvents: Array<() => Promise<void>> = [];
    private startupEventsReleased = false;
    private startupEventQueue: Promise<void> = Promise.resolve();

    async init(): Promise<void> {
        // App.initEvents() owns these process-lifetime IPC subscriptions; no view/model
        // owns the application event bus wiring.
        // Page operations (currently delegates to pages)
        rendererEvents.eOpenFile.subscribe((filePath) =>
            this.queueStartupEvent(() => this.openLaunchInput({ kind: "file", path: filePath })),
        );
        rendererEvents.eOpenDiff.subscribe((params) =>
            this.queueStartupEvent(() => this.openLaunchInput({ kind: "diff", ...params })),
        );
        rendererEvents.eShowPage.subscribe((pageId) => this.queueStartupEvent(() => this.handleShowPage(pageId)));
        rendererEvents.eMovePageIn.subscribe((data) => this.queueStartupEvent(() => this.handleMovePageIn(data)));
        rendererEvents.eMovePageOut.subscribe((pageId) => this.queueStartupEvent(() => this.handleMovePageOut(pageId)));

        // URL opening
        rendererEvents.eOpenUrl.subscribe((event) => this.queueStartupEvent(() => this.handleOpenUrl(event)));
        rendererEvents.eOpenClaimedBrowserDownload.subscribe((data) => this.queueStartupEvent(() => this.handleClaimedBrowserDownload(data)));
        rendererEvents.eOpenExternalUrl.subscribe((url) =>
            this.queueStartupEvent(() => this.openLaunchInput({ kind: "url", url })),
        );

        // Quit handler
        rendererEvents.eBeforeQuit.subscribe(this.handleBeforeQuit);
        rendererEvents.eReloadForLanguage.subscribe(this.handleReloadForLanguage);

        // Update check notification
        rendererEvents["eUpdateAvailable"].subscribe(this.handleUpdateAvailable);

        // Board `persephone.notify()` toast.
        rendererEvents["eBoardNotify"].subscribe(this.handleBoardNotify);

    }

    releaseStartupEvents(): void {
        this.startupEventsReleased = true;
        const pending = this.startupEvents;
        this.startupEvents = [];
        for (const operation of pending) this.enqueueStartupEvent(operation);
    }

    private queueStartupEvent(operation: () => Promise<void>): void {
        if (this.startupEventsReleased) {
            this.enqueueStartupEvent(operation);
            return;
        }
        this.startupEvents.push(operation);
    }

    private enqueueStartupEvent(operation: () => Promise<void>): void {
        this.startupEventQueue = this.startupEventQueue.then(operation).catch((error: unknown) => {
            console.error("Failed to process queued startup page event:", errMessage(error));
        });
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
        pages.startupRestore.close();
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
        pages.startupRestore.close();
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
