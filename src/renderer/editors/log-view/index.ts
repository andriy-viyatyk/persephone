import { TComponentState } from "../../core/state/state";
import { LogViewEditor, defaultLogViewEditorState } from "./LogViewEditor";
import { defineEditorModule } from "../base/editorRegistry";
import { LogViewEditorView } from "./LogViewEditorView";
import { logLogViewDialogAnswered } from "../../scripting/ai-vision/event-log";

export const logViewModule = defineEditorModule(LogViewEditor, {
    createEditor: () =>
        new LogViewEditor(new TComponentState({ ...defaultLogViewEditorState }), {
            reportDialogAnswered: logLogViewDialogAnswered,
        }),
    View: LogViewEditorView,
});

export { LogViewEditor, defaultLogViewEditorState };
export type { LogViewEditorState, LogQueueEvent } from "./LogViewEditor";
