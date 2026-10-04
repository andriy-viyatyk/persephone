import rendererEvents from "../../../ipc/renderer/renderer-events";
import { pagesModel } from "../pages";
import { app } from "../app";
import { createLinkData } from "../../../shared/link-data";
import { signalReadyToQuit } from "../window";
import { ui } from "../ui";
import { guard } from "../../core/utils/guard";
import { isBoardClaimedScheme, schemeOf } from "../../content/scheme-registry";
import { boardEditorId } from "../../editors/board/custom-editor-registry";
import { UpdateCheckResult } from "../../../ipc/api-param-types";
import { EventEndpoint } from "../../../ipc/api-types";
import type { PageDescriptor } from "../../../shared/types";
import type { LaunchInput } from "../../../shared/launch-input";
import { windowRecording } from "../window-recording";

/**
 * Renderer IPC events service.
 * Subscribes to IPC events and delegates to pagesModel methods.
 * Will be updated in to delegate to app.pages instead.
 */
export class RendererEventsService {
    async init(): Promise<void> {
        // App.initEvents() owns these process-lifetime IPC subscriptions; no view/model
        // owns the application event bus wiring.
        // Page operations (currently delegates to pagesModel)
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

        // Update check notification
        rendererEvents[EventEndpoint.eUpdateAvailable].subscribe(this.handleUpdateAvailable);

        // Board `persephone.notify()` toast (US-724)
        rendererEvents[EventEndpoint.eBoardNotify].subscribe(this.handleBoardNotify);

        // Board `persephone.openRawLink(href, { editor })` (US-756 C6)
        rendererEvents[EventEndpoint.eBoardOpenRawLink].subscribe(this.handleBoardOpenRawLink);
    }

    private handleBoardOpenRawLink = async (msg: { href: string; editor?: string; boardRoot: string }) => {
        if (!msg?.href) return;
        await guard("Failed to open link", () =>
            app.events.openRawLink.sendAsync(
                createLinkData(msg.href, { sourceId: "board", target: msg.editor, boardRoot: msg.boardRoot }),
            ),
        );
    };

    openLaunchInput = async (input: LaunchInput): Promise<void> => {
        switch (input.kind) {
            case "file":
                await guard("Failed to open file", () =>
                    app.events.openRawLink.sendAsync(createLinkData(input.path)),
                );
                return;
            case "url":
                // Route through the pipeline — the HTTP resolver decides content vs browser.
                // `browserMode: "internal"` prevents the shell.openExternal fallback, which
                // would loop back to us when Persephone is the OS default browser.
                await guard("Failed to open URL", () =>
                    app.events.openRawLink.sendAsync(
                        createLinkData(input.url, { browserMode: "internal" }),
                    ),
                );
                return;
            case "diff":
                await guard("Failed to open diff", () =>
                    pagesModel.openDiff({
                        firstPath: input.firstPath,
                        secondPath: input.secondPath,
                    }),
                );
        }
    };

    private handleShowPage = async (pageId: string) => {
        await guard("Failed to show page", () => pagesModel.showPage(pageId));
    };

    private handleMovePageIn = async (data: { page: PageDescriptor; targetPageId: string | undefined } | undefined) => {
        await guard("Failed to move page", () => pagesModel.movePageIn(data));
    };

    private handleMovePageOut = async (pageId: string) => {
        await guard("Failed to move page", () => pagesModel.movePageOut(pageId));
    };

    private handleOpenUrl = async (event: { url: string; boardRoot?: string; unattributedPopup?: boolean }) => {
        await guard("Failed to open URL", () =>
            app.events.openRawLink.sendAsync(createLinkData(event.url, {
                ...(event.boardRoot ? { boardRoot: event.boardRoot, sourceId: "board" } : {}),
                ...(event.unattributedPopup ? { unattributedPopup: true } : {}),
            })),
        );
    };

    private handlePipelineCandidate = async (url: string) => {
        const scheme = schemeOf(url);
        if (!scheme || !isBoardClaimedScheme(scheme)) return;

        await guard("Failed to open URL", () =>
            app.events.openRawLink.sendAsync(createLinkData(url)),
        );
    };

    private handleClaimedBrowserDownload = async (data: {
        url: string;
        boardRoot: string;
        sessionHandle?: string;
    }) => {
        await guard("Failed to open URL", () =>
            app.events.openRawLink.sendAsync(
                createLinkData(data.url, {
                    target: boardEditorId(data.boardRoot),
                    sessionHandle: data.sessionHandle,
                }),
            ),
        );
    };

    private handleBeforeQuit = async () => {
        try {
            if (windowRecording.state.status === "recording" || windowRecording.state.status === "paused") {
                await windowRecording.stop("window-close");
            } else if (windowRecording.state.status === "ready") {
                await windowRecording.cancel();
            }
            await Promise.all(
                pagesModel.state.get().pages.map((model) => model.saveState())
            );
            await pagesModel.saveState();
        } catch (err) {
            console.error("Failed to save pages on quit:", err);
        }
        signalReadyToQuit();
    };

    private handleBoardNotify = (data: { message: string; type?: "info" | "success" | "warning" | "error"; persistent?: boolean }) => {
        void ui.notify(data.message, data.type ?? "info", { persistent: data.persistent === true });
    };

    private handleUpdateAvailable = async (result: UpdateCheckResult) => {
        if (result.updateAvailable && result.releaseInfo) {
            const closeResult = await ui.notify(
                `New version ${result.releaseInfo.version} is available! Click to open About page.`,
                "info",
            );
            if (closeResult === "clicked") {
                pagesModel.showAboutPage();
            }
        }
    };
}
