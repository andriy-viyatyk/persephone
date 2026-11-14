import { TComponentState } from "../../core/state/state";
import {
    McpInspectorEditorModel,
    getDefaultMcpInspectorEditorState,
} from "./McpInspectorEditorModel";
import { McpInspectorEditorView } from "./McpInspectorView";
import { defineEditorModule } from "../base/editorRegistry";

export const mcpModule = defineEditorModule(McpInspectorEditorModel, {
    createEditor: () =>
        new McpInspectorEditorModel(new TComponentState(getDefaultMcpInspectorEditorState())),
    View: McpInspectorEditorView,
});

export { McpInspectorEditorModel, getDefaultMcpInspectorEditorState } from "./McpInspectorEditorModel";
export type {
    McpInspectorEditorState, McpPanelId,
} from "./McpInspectorEditorModel";
export type { McpToolInfo, McpToolResult, McpToolsPanelState } from "./McpToolsModel";
export type { McpResourceInfo, McpResourceContent, McpResourcesPanelState } from "./McpResourcesModel";
export type { McpPromptInfo, McpPromptMessage, McpPromptsPanelState } from "./McpPromptsModel";
