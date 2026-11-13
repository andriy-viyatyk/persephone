import { registerBaseEditorSwitchStrategies, editorSwitchStrategies } from "./base/editor-switch-strategies";
import { registerBoardInfoEditorSwitchStrategies } from "./board-info/editor-switch-strategies";
import { registerCategoryEditorSwitchStrategies } from "./category/editor-switch-strategies";
import { registerBoardEditorSwitchStrategies } from "./board/editor-switch-strategies";

export function registerEditorSwitchStrategies(): void {
    registerBaseEditorSwitchStrategies(editorSwitchStrategies);
    registerBoardInfoEditorSwitchStrategies();
    registerCategoryEditorSwitchStrategies();
    registerBoardEditorSwitchStrategies();
}
