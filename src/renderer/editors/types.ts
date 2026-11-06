import { EditorOrHost } from "./base";
import type { VanillaViewCtor } from "../uikit/shared/vanilla-view";

export interface EditorViewModule {
    View: FileEditorView;
}

export type FileEditorView<T extends EditorOrHost = EditorOrHost> =
    VanillaViewCtor<{ model: T }>;
