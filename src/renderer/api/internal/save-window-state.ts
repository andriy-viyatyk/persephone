import { pagesModel } from "../pages";
import { windowRecording } from "../window-recording";

/** Save page state in the same order used before shutdown. */
export async function saveWindowStateForShutdown(): Promise<void> {
    if (windowRecording.state.status === "recording" || windowRecording.state.status === "paused") {
        await windowRecording.stop("window-close");
    } else if (windowRecording.state.status === "ready") {
        await windowRecording.cancel();
    }
    await Promise.all(pagesModel.state.get().pages.map((model) => model.saveState()));
    await pagesModel.saveState();
}
