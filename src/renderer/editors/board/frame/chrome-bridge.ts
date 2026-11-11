import type { BoardToHostEvents } from "../../../../ipc/board-bridge/frame-protocol";
import { errMessage } from "../../../../shared/utils";
import { boardRegistry } from "../../../api/boards/board-registry";
import type { BoardEditorModel } from "../BoardEditorModel";
import {
    normalizeBoardStatusBarPatches,
    normalizeBoardStatusBarSet,
    normalizeToolbarControlPatches,
    normalizeToolbarControlSet,
    type ToolbarAction,
} from "../chrome/board-chrome-protocol";
import type { BoardChromeOwner, BoardSaveRequest } from "../model/BoardFrameChrome";
import { BoardFrameSession } from "./BoardFrameSession";
import { BoardFrameEndpoint } from "./BoardFrameEndpoint";

interface ChromeContext {
    model: BoardEditorModel;
    generation: number
}
type ChromeHandler<K extends keyof BoardToHostEvents> = (payload: BoardToHostEvents[K], context: ChromeContext) => void;

export class ChromeBridge {
    constructor(
        private readonly model: BoardEditorModel,
        private readonly boardRoot: string,
        private readonly isMain: boolean,
        private readonly session: BoardFrameSession,
        private readonly endpoint: BoardFrameEndpoint,
    ) {}

    readonly working: ChromeHandler<"working"> = ({ working }, context) => context.model.setWorking(working === true);
    readonly modified: ChromeHandler<"modified.set"> = ({ modified }, context) =>
        context.model.setBoardModified(modified === true);
    readonly muted: ChromeHandler<"muted.set"> = ({ muted }, context) => context.model.chrome.setMuted(
        this.owner(context.generation),
        muted === null ? null : muted === true,
        () => this.sendMuteToggle(context.generation),
    );
    readonly saveHandler: ChromeHandler<"saveHandler"> = ({ handlerId, registered }, context) => {
        const owner = this.owner(context.generation);
        if (registered) {
            const request: BoardSaveRequest = (discard) => this.requestSave(context.generation, request, discard);
            context.model.chrome.setSaveHandler(owner, handlerId, request);
        } else {
            context.model.chrome.clearSaveHandler(owner, handlerId);
        }
    };
    readonly statusText: ChromeHandler<"statusText.set"> = ({ statusText }, context) => {
        context.model.chrome.setStatusText(
            this.owner(context.generation),
            typeof statusText === "string" ? statusText : "",
        );
    };
    readonly toolbarText: ChromeHandler<"toolbar.setText"> = ({ toolbarText }, context) => {
        context.model.chrome.setToolbarText(
            this.owner(context.generation),
            typeof toolbarText === "string" ? toolbarText : "",
        );
    };
    readonly toolbarSet: ChromeHandler<"toolbar.set"> = ({ controls }, context) => {
        const warning = (message: string): void => this.session.log("warn", message);
        const normalized = normalizeToolbarControlSet(controls, warning);
        context.model.chrome.setToolbar(this.owner(context.generation), normalized, warning);
    };
    readonly toolbarUpdate: ChromeHandler<"toolbar.update"> = ({ controls }, context) => {
        const warning = (message: string): void => this.session.log("warn", message);
        const patches = normalizeToolbarControlPatches(controls, warning);
        context.model.chrome.updateToolbar(this.owner(context.generation), patches, warning);
    };
    readonly statusBarSet: ChromeHandler<"statusBar.set"> = ({ items }, context) => {
        const warning = (message: string): void => this.session.log("warn", message);
        const normalized = normalizeBoardStatusBarSet(items, warning);
        context.model.chrome.setStatusBar(this.owner(context.generation), normalized, warning);
    };
    readonly statusBarUpdate: ChromeHandler<"statusBar.update"> = ({ items }, context) => {
        const warning = (message: string): void => this.session.log("warn", message);
        const patches = normalizeBoardStatusBarPatches(items, warning);
        context.model.chrome.updateStatusBar(this.owner(context.generation), patches, warning);
    };

    private owner(generation: number): BoardChromeOwner {
        return { token: this.session, generation };
    }

    public sendStatusBarAction(event: { id: string }, generation: number): void {
        if (!this.isMain || !boardRegistry.isPermitted(this.boardRoot)) return;
        this.endpoint.emit("statusBar.action", { id: event.id }, { from: { generation } });
    }

    private sendMuteToggle(generation: number): void {
        if (!this.isMain || !boardRegistry.isPermitted(this.boardRoot)) return;
        this.endpoint.emit("page.muteToggle", {}, { from: { generation } });
    }

    public sendToolbarControl(event: ToolbarAction): void {
        if (!this.isMain || !boardRegistry.isPermitted(this.boardRoot)) return;
        this.endpoint.emit("toolbar.control", {
            id: event.id,
            type: event.type,
            ...(event.type !== "button" && event.value !== undefined ? { value: event.value } : {}),
        });
    }

    private requestSave(generation: number, request: BoardSaveRequest, discard = false): Promise<{
        success: boolean;
        error?: string
    }> {
        const stamp = this.session.current();
        if (!this.isMain || !stamp || stamp.generation !== generation || this.model.chrome.saveRequest !== request) {
            return Promise.resolve({
                success: false,
                error: "The board has no live Save handler. Reload the board to restore it, or choose Don't Save.",
            });
        }
        return this.endpoint.request("save", discard ? { discard } : {}, {
            timeoutMs: discard ? 3_000 : 30_000,
            timeoutError: () => new Error("The board did not finish saving within 30 seconds."),
            unavailableError: () => new Error("The board frame is no longer available."),
        }).then((result) => ({ success: result.success === true, ...(result.error ? { error: result.error } : {}) }),
            (error: unknown) => ({ success: false, error: errMessage(error) }));
    }
}
