import { TComponentState } from "../../core/state/state";
import { VideoEditor, getDefaultVideoEditorState } from "./VideoEditor";
import { VideoEditorView } from "./VideoView";
import { detectVideoFormat } from "./video-types";
import { defineEditorModule } from "../base/editorRegistry";
import type { EditorModelInstance as EditorModel } from "../base/EditorModel";

export const videoModule = defineEditorModule(VideoEditor, {
    createEditor: () =>
        new VideoEditor(new TComponentState(getDefaultVideoEditorState())),
    View: VideoEditorView,
    newEditorModel: async (filePath?: string) => {
        const initialState = getDefaultVideoEditorState();
        if (filePath) {
            initialState.filePath = filePath;
            initialState.inputText = filePath;
            initialState.url = filePath;
            initialState.format = detectVideoFormat(filePath);
            initialState.playerState = "loading";
        }
        return new VideoEditor(
            new TComponentState(initialState),
        ) as unknown as EditorModel;
    },
});

export { VideoEditor, getDefaultVideoEditorState };
export type { VideoEditorState } from "./VideoEditor";
export { VideoEditor as VideoEditorModel } from "./VideoEditor";
export type { VideoEditorState as VideoEditorModelState } from "./VideoEditor";
