import { api } from "../../../ipc/renderer/api";
import { appWindow } from "../../api/window";
import { boardDisplayText, boardMetadataKeys, ensureBoardDisplayText } from "../../api/boards/board-display-text";
import { readBoardManifest } from "../../api/boards/board-manifest-io";
import { fpBasename } from "../../core/utils/file-path";
import { renderBoardIconDataUrl } from "./board-window-icon";
import { boardIdentity } from "./board-identity";
import { rendererProfileName } from "../../../shared/application-profile";
import { BoardRoot } from "../../../shared/board/board-root";
import { SerialQueue } from "../../../shared/serial-queue";

class BoardWindowIdentity {
    private active = true;
    private revision = 0;
    private readonly queue = new SerialQueue();

    public start(): void {
        void this.refresh();
    }

    public dispose(): void {
        this.active = false;
        this.revision++;
    }

    public async refresh(): Promise<void> {
        const root = appWindow.boardRoot;
        if (!root || !this.active) return;
        const revision = ++this.revision;
        try {
            const manifest = await readBoardManifest(root);
            if (!this.active || revision !== this.revision) return;
            if (manifest) await ensureBoardDisplayText(root, manifest);
            if (!this.active || revision !== this.revision) return;
            const fallback = manifest?.name?.trim() || fpBasename(root);
            const name = boardDisplayText(root, manifest, boardMetadataKeys.name, fallback);
            document.title = name + (rendererProfileName() ? ` — ${rendererProfileName()}` : "");
            const iconDataUrl = await renderBoardIconDataUrl(root);
            if (!this.active || revision !== this.revision) return;
            const identity = { displayName: name, iconDataUrl };
            await this.queue.run(async (): Promise<void> => {
                if (!this.active || revision !== this.revision) return;
                await api.setBoardWindowIdentity(identity);
            });
        } catch (error) {
            console.error("Failed to update board window identity", error);
        }
    }
}

export function installBoardWindowIdentity(): () => void {
    if (!appWindow.isBoardMode) return () => {};
    const identity = new BoardWindowIdentity();
    identity.start();
    const unsubscribe = boardIdentity.onChanged((event) => {
        if (event.kind === "text") {
            if (appWindow.boardRoot && BoardRoot.tryFrom(event.root)?.equals(appWindow.boardRoot)) {
                void identity.refresh();
            }
        } else if (event.root && appWindow.boardRoot && BoardRoot.tryFrom(event.root)?.equals(appWindow.boardRoot)) {
            void identity.refresh();
        }
    });
    return () => {
        unsubscribe();
        identity.dispose();
    };
}
