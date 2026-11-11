import type { BoardToHostEvents } from "../../../../ipc/board-bridge/frame-protocol";
import { errMessage } from "../../../../shared/utils";
import { app } from "../../../api/app";
import { cycleAppTheme } from "../../../api/cycle-app-theme";
import { getPreviewGeneration } from "../../../theme/themes";
import { dismissOverlays } from "../../../uikit/shared/overlayLayer";
import type { BoardEditorModel } from "../BoardEditorModel";
import { BoardFrameSession } from "./BoardFrameSession";

export class BoardHostEvents {
    private readonly unsubscribeRetire: () => void;
    constructor(private readonly model: BoardEditorModel, private readonly session: BoardFrameSession) {
        this.unsubscribeRetire = session.onRetire((r) => {
            if (!(r.reason === "reload" && !r.hadLoaded) && r.reason !== "load-error") void this.endOwnedThemePreview();
        });
    }
    interact(frame: HTMLIFrameElement): void {
        dismissOverlays(frame);

    }
    error({ message }: BoardToHostEvents["error"]): void {
        if (typeof message === "string" && message) this.session.log("error", message);

    }
    log({ level, message }: BoardToHostEvents["log"]): void {
        if (typeof message === "string" && message) this.session.log(level === "warn" ? "warn" : "error", message);

    }
    busy({ busy }: BoardToHostEvents["busy"]): void {
        this.model.setBusy(!!busy);

    }
    cycle({ direction }: BoardToHostEvents["theme.cycle"]): void {
        cycleAppTheme(direction === 1 ? 1 : -1);

    }

    private async endOwnedThemePreview(): Promise<void> {
        const previewGeneration = this.model.chrome.takeBoardThemePreviewGeneration(this.session.boardId);
        if (previewGeneration === undefined || getPreviewGeneration() !== previewGeneration) return;
        try {
            await app.themes.endPreview();
        } catch (error) {
            this.session.log("warn", `Could not restore the theme after board preview: ${errMessage(error)}`);
        }
    }

    detach(): void {
        this.unsubscribeRetire();
    }

}
