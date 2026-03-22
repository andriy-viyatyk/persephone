import { showAppPopupMenu } from "../../ui/dialogs/poppers/showPopupMenu";
import { parseObject } from "../../core/utils/parse-utils";
import { api } from "../../../ipc/renderer/api";
import { ui } from "../ui";
import { scriptRunner } from "../../scripting/ScriptRunner";
import { fs } from "../fs";
import { appWindow } from "../window";
import { RendererEvent } from "../../../ipc/api-types";
import { windowClosing } from "../../core/state/events";

/**
 * Global event service for document/window listeners.
 * Handles: contextmenu, drag-drop, unhandled promise rejections.
 */
export class GlobalEventService {
    async init(): Promise<void> {
        document.addEventListener("contextmenu", this.handleContextMenu);
        document.addEventListener("dragover", this.handleDragOver);
        document.addEventListener("drop", this.captureDrop, true);
        document.addEventListener("drop", this.handleDrop);
        document.addEventListener("wheel", this.handleWheel, { passive: false });
        window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
        window.addEventListener("beforeunload", this.handleBeforeUnload);
    }

    private handleContextMenu = async (e: PointerEvent) => {
        e.preventDefault();
        if (e.contextMenuPromise) {
            await e.contextMenuPromise;
        }
        const event = e.contextMenuEvent;
        showAppPopupMenu(e.clientX, e.clientY, event?.items || []);
    };

    private handleDragOver = (e: DragEvent) => {
        const types = e.dataTransfer?.types || [];
        if (types.includes("application/js-notepad-tab")) {
            e.dataTransfer.dropEffect = "move";
        }
        e.preventDefault();
        e.stopPropagation();
    };

    private handleDrop = (e: DragEvent) => {
        const dataStr = e.dataTransfer?.getData("application/js-notepad-tab");
        const data = parseObject(dataStr);
        if (
            data &&
            data.sourceWindowIndex !== undefined &&
            data.sourceWindowIndex !== appWindow.windowIndex
        ) {
            api.addDragEvent({ targetWindowIndex: appWindow.windowIndex });
        }
    };

    private captureDrop = (e: DragEvent) => {
        let filePath: string | undefined = undefined;

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];

            try {
                filePath = window.electron.getPathForFile(file);
            } catch (error) {
                console.error("Error getting file path:", error);
            }
        }

        if (!filePath) {
            const textData = e.dataTransfer.getData("text/plain");
            filePath = textData?.split("\n")[0]?.trim();
        }

        if (filePath && fs.fileExistsSync(filePath)) {
            e.preventDefault();
            e.stopPropagation();
            window.electron.ipcRenderer.sendMessage(RendererEvent.fileDropped, filePath);
        }
    };

    private handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.5 : -0.5;
            api.zoom(delta);
        }
    };

    private handleUnhandledRejection = (e: PromiseRejectionEvent) => {
        if (scriptRunner.handlePromiseException) {
            ui.notify(`Unhandled promise rejection: ${e.reason}`, "error");
        }
    };

    private handleBeforeUnload = () => {
        windowClosing.send(undefined as any);
    };
}
