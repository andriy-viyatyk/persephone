import { IState } from "../../core/state/state";
import { EditorView } from "../../../shared/types";
import { EditorStateStorage } from "./EditorStateStorageContext";
import type { ContentViewModel } from "./ContentViewModel";

/**
 * Minimal state shape required by content view models.
 * Both TextFileEditorModelState and NoteItemEditModel's state extend this.
 */
export interface IContentHostState {
    content: string;
    language?: string;
    editor?: EditorView;
}

/**
 * Shared interface for anything that hosts editable text content.
 *
 * Implemented by:
 * - TextFileModel (standalone page tab)
 * - NoteItemEditModel (notebook note — embedded editor)
 *
 * Replaces the current duck-typing cast (`model as unknown as TextFileModel`).
 */
export interface IContentHost {
    /** Unique identifier for state persistence (page ID or note ID). */
    readonly id: string;

    /** Reactive state containing at least content, language, and editor type. */
    readonly state: IState<IContentHostState>;

    /** Update the text content. */
    changeContent(content: string, byUser?: boolean): void;

    /** Change the active editor type. */
    changeEditor(editor: EditorView): void;

    /** Change the language. */
    changeLanguage(language: string | undefined): void;

    /** State storage for persisting editor-specific state (column widths, filters, etc.). */
    readonly stateStorage: EditorStateStorage;

    /**
     * Acquire a view model by editor ID.
     * Creates on first call, increments reference count on subsequent calls.
     * Async because editor modules are lazy-loaded.
     */
    acquireViewModel(editorId: EditorView): Promise<ContentViewModel<any>>;

    /**
     * Acquire a view model synchronously.
     * Returns undefined if the editor module hasn't been loaded yet.
     * Call prepareViewModel() first to ensure the module is cached.
     */
    acquireViewModelSync(editorId: EditorView): ContentViewModel<any> | undefined;

    /**
     * Pre-load and cache the editor module so that acquireViewModelSync() can work.
     */
    prepareViewModel(editorId: EditorView): Promise<void>;

    /** Release a reference. When refs reach 0, the model is disposed. */
    releaseViewModel(editorId: EditorView): void;
}
