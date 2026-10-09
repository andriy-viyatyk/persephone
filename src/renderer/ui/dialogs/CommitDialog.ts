import { TDialogModel } from "../../core/state/model";
import { TComponentState } from "../../core/state/state";
import { showDialog } from "./Dialogs";
import { registerDialogView } from "./dialog-view-registry";
import { CommitDialogView } from "./CommitDialogView";
import { DialogButton } from "./dialog-buttons";

export const commitDialogId = Symbol("commitDialog");

export interface CommitDialogProps {
    title?: string;
    branch?: string;
    originalBranch?: string;
    message?: string;
    name?: string;
    email?: string;
    buttons?: string[];
    committing?: boolean;
}

export type CommitAction = (result: CommitResult) => Promise<boolean>;

const defaultCommitDialogProps: CommitDialogProps = {
    title: undefined,
    branch: undefined,
    message: "",
    name: "",
    email: "",
    buttons: [DialogButton.commit, DialogButton.cancel],
};

export interface CommitResult {
    message: string;
    name: string;
    email: string;
    branch: string;
    button: string;
    buttonLabel: string;
}

export class CommitDialogModel extends TDialogModel<CommitDialogProps, CommitResult | undefined> {
    private viewDisposed = false;
    onAction?: CommitAction;

    handleKeyDown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            const state = this.state.get();
            const action = state.buttons?.find((button) => button !== DialogButton.cancel) ?? DialogButton.commit;
            void this.submit(action);
        }
    };

    setMessage = (value: string) => this.state.update((state) => { state.message = value; });
    setName = (value: string) => this.state.update((state) => { state.name = value; });
    setEmail = (value: string) => this.state.update((state) => { state.email = value; });
    setBranch = (value: string) => this.state.update((state) => { state.branch = value; });

    canClose = async (result?: CommitResult): Promise<boolean> => {
        if (this.viewDisposed) return false;
        if (!result || !this.onAction) return true;
        return this.onAction(result);
    };

    submit = async (button: string, buttonLabel = button) => {
        const state = this.state.get();
        if (state.committing || !state.message?.trim() || !state.branch?.trim()) return;
        this.state.update((draft) => { draft.committing = true; });
        const closed = await this.close({
            message: state.message ?? "",
            name: state.name ?? "",
            email: state.email ?? "",
            branch: state.branch ?? "",
            button,
            buttonLabel,
        });
        if (this.viewDisposed) return;
        if (!closed) this.state.update((draft) => { draft.committing = false; });
    };

    disposeView = () => {
        this.viewDisposed = true;
    };
}

export function actionButtonLabel(button: string, branchChanged: boolean): string {
    if (!branchChanged) return button;
    if (button === DialogButton.commit) return "Create Branch & Commit";
    if (button === DialogButton.commitAndPush) return "& Push";
    return button;
}

registerDialogView(commitDialogId, CommitDialogView);

export function showCommitDialog(props: CommitDialogProps & { onAction?: CommitAction }) {
    const { onAction, ...rest } = props;
    const modelState = {
        ...defaultCommitDialogProps,
        ...rest,
        originalBranch: rest.branch,
    };

    const model = new CommitDialogModel(new TComponentState(modelState));
    model.onAction = onAction;
    return showDialog({
        viewId: commitDialogId,
        model,
    }) as Promise<CommitResult | undefined>;
}
