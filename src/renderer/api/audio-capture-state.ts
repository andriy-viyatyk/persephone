import { TOneState } from "../core/state/state";
import { errMessage } from "../../shared/utils";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { api } from "../../ipc/renderer/api";

export interface AudioCaptureSnapshot {
    count: number;
    revision: number;
}

export class AudioCaptureState {
    readonly state = new TOneState<AudioCaptureSnapshot>({ count: 0, revision: -1 });
    private unsubscribe: (() => void) | undefined;
    private started = false;

    start(): void {
        if (this.started) return;
        this.started = true;
        this.unsubscribe = rendererEvents.eAudioCaptureCount.subscribe((snapshot) => this.apply(snapshot));
        void api.getAudioCaptureCount().then((snapshot) => this.apply(snapshot)).catch((error: unknown) => {
            console.error("Failed to read audio capture state:", errMessage(error));
        });
    }

    dispose(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private apply(snapshot: AudioCaptureSnapshot): void {
        const previous = this.state.get();
        if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision <= previous.revision) return;
        this.state.set(snapshot);
    }
}
