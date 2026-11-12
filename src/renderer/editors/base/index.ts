export { EditorModel } from "./EditorModel";
export type { EditorStateBase, RestoreData } from "./EditorModel";

import type { IEditorState } from "../../../shared/types";
import { untranslated } from "../../../shared/i18n/t";

/** Create the base `IEditorState` fields that editor-specific default-state factories extend. */
export function getDefaultEditorModelState(): IEditorState {
    return {
        id: crypto.randomUUID(),
        title: untranslated("untitled"),
        modified: false,
        language: undefined,
        filePath: undefined,
        editor: undefined,
    };
}

export { CONTENT_HOST_TRAIT } from './editor-traits';
export type { IContentHostTrait } from './editor-traits';
export { TEXT_SELECTION_TRAIT, TEXT_NAVIGATION_TRAIT } from './editor-traits';
export type { ITextSelectionTrait, ITextNavigationTrait } from './editor-traits';
export { editorRegistry } from './editorRegistry';
export type { EditorDefinition, EditorModule, AcceptanceInput } from './editorRegistry';
