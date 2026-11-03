import { TComponentState } from "../../core/state/state";
import { EditorModel, type EditorStateBase } from "../base/EditorModel";

export interface RestoreFailedState extends EditorStateBase {
    error: string;
    retrying: boolean;
}

export class RestoreFailedEditor extends EditorModel<RestoreFailedState> {
    readonly editorId = "restore-failed";
    noLanguage = true;
    skipSave = true;
    retry: () => Promise<void> = async () => {};
    closePage: () => Promise<boolean> = async () => false;

    constructor(id: string, title: string, error: string) {
        super(new TComponentState({ id, title, error, modified: false, retrying: false }));
    }
}
