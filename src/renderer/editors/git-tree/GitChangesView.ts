import type { CellContext } from "../../uikit/DataGrid";
import { FileGridView } from "../../components/file-grid/FileGridView";
import type { FileGridProps, FileGridItem } from "../../components/file-grid/FileGrid";
import { gitStatusMarkup } from "../../components/git-tree/git-status-meta";
import type { GitChangesState } from "../../components/git-tree/GitChangesModel";
import { createPanelElement, applyPanelAttributes, resolvePanelAttributes } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { SpacerView } from "../../uikit/Spacer/SpacerView";
import { SplitterView } from "../../uikit/Splitter/SplitterView";
import type { SplitterProps } from "../../uikit/Splitter/SplitterView";
import { ButtonView } from "../../uikit/Button/ButtonView";
import { IconButtonView } from "../../uikit/IconButton/IconButtonView";
import type { MenuItem } from "../../uikit/Menu";
import { createIconElement } from "../../uikit/shared/slots";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { showConfirmationDialog } from "../../ui/dialogs/ConfirmationDialog";
import { DialogButton, dialogButton } from "../../ui/dialogs/dialog-buttons";
import { showCommitDialog } from "../../ui/dialogs/CommitDialog";
import type { GitFileChange } from "../../../ipc/git-ipc";
import { t } from "../../../shared/i18n/t";
import { GitTreeEditorModel } from "./GitTreeEditorModel";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";
import "../../uikit/Spacer/Spacer.css";
import "../../uikit/Splitter/Splitter.css";
import "../../uikit/Button/Button.css";
import "../../uikit/IconButton/IconButton.css";

/** Expand a selection to git path args - renames need both new + old path. */
function expandPaths(changes: GitFileChange[]): string[] {
    return changes.flatMap((change) => change.oldPath
        ? [change.path, change.oldPath]
        : [change.path]);
}

export interface GitChangesViewProps {
    model: GitTreeEditorModel;
}

/** Native working-tree status body for the merged Git secondary view. */
export class GitChangesView extends VanillaView<GitChangesViewProps> {
    private model: GitTreeEditorModel;
    private layoutHost: HTMLDivElement | undefined;
    private unavailableHost: HTMLDivElement | undefined;
    private stagedPanel: HTMLDivElement | undefined;
    private unstagedGrid: FileGridView | undefined;
    private stagedGrid: FileGridView | undefined;
    private splitter: SplitterView | undefined;
    private commitButton: ButtonView | undefined;
    private stageButton: IconButtonView | undefined;
    private unstageButton: IconButtonView | undefined;
    private bottomHeight: number | undefined;
    private branch: string | undefined;
    private selUnstaged: GitFileChange[] = [];
    private selStaged: GitFileChange[] = [];

    public constructor(props: GitChangesViewProps) {
        super(props, createPanelElement({
            name: "git-changes",
            direction: "column",
            flex: true,
            overflow: "hidden",
            width: "100%",
        }));
        this.model = props.model;
    }

    protected onMount(): void {
        const state = this.model.changes.state.get();
        this.unavailableHost = createPanelElement({ padding: "md" }, [
            createTextElement(t("git.gitUnavailable"), { color: "light" }),
        ]);
        this.layoutHost = createPanelElement({
            direction: "column",
            flex: true,
            overflow: "hidden",
            width: "100%",
        });
        this.root.append(this.unavailableHost, this.layoutHost);

        const unstagedPanel = createPanelElement({
            name: "git-changes-unstaged",
            direction: "column",
            flex: true,
            overflow: "hidden",
            minHeight: 60,
        });
        this.stagedPanel = createPanelElement({
            name: "git-changes-staged",
            direction: "column",
            overflow: "hidden",
            shrink: false,
            height: 150,
            minHeight: 60,
        });
        const stagedToolbar = createPanelElement({
            name: "git-changes-toolbar",
            direction: "row",
            align: "center",
            paddingX: "xs",
            paddingY: "xs",
            gap: "sm",
            shrink: false,
        });
        const stagedGridHost = createPanelElement({
            direction: "column",
            flex: true,
            height: 0,
            overflow: "hidden",
        });

        this.commitButton = this.child(new ButtonView(this.commitButtonProps(state.staged.length)));
        const toolbarSpacer = this.child(new SpacerView({}));
        this.stageButton = this.child(new IconButtonView(this.stageButtonProps()));
        this.unstageButton = this.child(new IconButtonView(this.unstageButtonProps()));
        stagedToolbar.append(
            this.commitButton.root,
            toolbarSpacer.root,
            this.stageButton.root,
            this.unstageButton.root,
        );

        this.unstagedGrid = this.child(new FileGridView(this.gridProps("unstaged", state.unstaged)));
        this.stagedGrid = this.child(new FileGridView(this.gridProps("staged", state.staged)));
        unstagedPanel.append(this.unstagedGrid.root);
        stagedGridHost.append(this.stagedGrid.root);

        this.splitter = this.child(new SplitterView(this.splitterProps(150)));
        this.stagedPanel.append(stagedToolbar, stagedGridHost);
        this.layoutHost.append(unstagedPanel, this.splitter.root, this.stagedPanel);

        this.commitButton.mount();
        toolbarSpacer.mount();
        this.stageButton.mount();
        this.unstageButton.mount();
        this.unstagedGrid.mount();
        this.stagedGrid.mount();
        this.splitter.mount();

        this.bind(
            this.model.changes.state,
            (changes) => ({
                unstaged: changes.unstaged,
                staged: changes.staged,
                gitOk: changes.gitOk,
                branch: changes.branch,
            }),
            this.applyState,
        );
        this.seedDefaultSplit();
    }

    protected onUpdate(props: GitChangesViewProps): void {
        this.model = props.model;
        this.applyState(this.snapshot());
    }

    protected onDispose(): void {
        this.layoutHost = undefined;
        this.unavailableHost = undefined;
        this.stagedPanel = undefined;
        this.unstagedGrid = undefined;
        this.stagedGrid = undefined;
        this.splitter = undefined;
        this.commitButton = undefined;
        this.stageButton = undefined;
        this.unstageButton = undefined;
    }

    private snapshot(): Pick<GitChangesState, "unstaged" | "staged" | "gitOk" | "branch"> {
        const state = this.model.changes.state.get();
        return {
            unstaged: state.unstaged,
            staged: state.staged,
            gitOk: state.gitOk,
            branch: state.branch,
        };
    }

    private readonly applyState = (state: Pick<GitChangesState, "unstaged" | "staged" | "gitOk" | "branch">): void => {
        this.branch = state.branch;
        this.unstagedGrid?.update(this.gridProps("unstaged", state.unstaged));
        this.stagedGrid?.update(this.gridProps("staged", state.staged));
        this.updateControls(state.staged.length);
        this.setUnavailable(!state.gitOk);
    };

    private setUnavailable(unavailable: boolean): void {
        if (!this.unavailableHost || !this.layoutHost) return;
        this.unavailableHost.hidden = !unavailable;
        this.unavailableHost.style.display = unavailable ? "" : "none";
        this.layoutHost.hidden = unavailable;
        this.layoutHost.style.display = unavailable ? "none" : "";
    }

    private gridProps(
        listKind: "unstaged" | "staged",
        changes: GitFileChange[],
    ): FileGridProps {
        const changeMap = new Map(changes.map((change) => [change.path, change]));
        const label = t(listKind === "unstaged" ? "git.unstaged" : "git.staged");
        const moveIcon = createIconElement(
            listKind === "unstaged" ? "filter-arrow-down" : "filter-arrow-up",
        );
        return {
            name: `git-changes-${listKind}`,
            label,
            items: changes.map((change) => ({
                filePath: change.path,
                title: change.path,
                status: change.status,
            })),
            onClick: (item) => {
                const change = changeMap.get(item.filePath);
                if (change) this.model.openChangeDiff(change, listKind);
            },
            onDoubleClick: (item) => {
                const change = changeMap.get(item.filePath);
                if (change) this.move(listKind, [change]);
            },
            onSelectionChange: (items) => this.setSelection(listKind, items, changeMap),
            getTrailing: (cell: CellContext<FileGridItem>) => {
                const change = changeMap.get(cell.row.filePath);
                return change ? gitStatusMarkup(change.status) : "";
            },
            getContextMenuItems: (selectedItems) => {
                const selected = selectedItems
                    .map((item) => changeMap.get(item.filePath))
                    .filter((change): change is GitFileChange => !!change);
                if (!selected.length) return [];
                const count = selected.length;
                const items: MenuItem[] = [{
                    id: listKind === "unstaged" ? "stage-files" : "unstage-files",
                    label: t(listKind === "unstaged" ? "git.stageFiles" : "git.unstageFiles", { count }),
                    icon: moveIcon,
                    onClick: () => this.move(listKind, selected),
                }];
                if (listKind === "unstaged") {
                    items.push({
                        id: "reset-files",
                        label: t("git.resetFiles", { count }),
                        icon: createIconElement("delete"),
                        startGroup: true,
                        onClick: () => void this.reset(selected),
                    });
                }
                return items;
            },
            compact: true,
        };
    }

    private setSelection(
        listKind: "unstaged" | "staged",
        items: FileGridItem[],
        changeMap: Map<string, GitFileChange>,
    ): void {
        const changes = items
            .map((item) => changeMap.get(item.filePath))
            .filter((change): change is GitFileChange => !!change);
        if (listKind === "unstaged") this.selUnstaged = changes;
        else this.selStaged = changes;
        this.updateControls(this.model.changes.state.get().staged.length);
    }

    private readonly move = (listKind: "unstaged" | "staged", changes: GitFileChange[]): void => {
        if (!changes.length) return;
        const paths = expandPaths(changes);
        if (listKind === "unstaged") void this.model.changes.stagePaths(paths);
        else void this.model.changes.unstagePaths(paths);
    };

    private readonly reset = async (changes: GitFileChange[]): Promise<void> => {
        if (!changes.length) return;
        const count = changes.length;
        const hasUntracked = changes.some((change) => change.status === "?");
        const choice = await showConfirmationDialog({
            title: t("git.resetChangesTitle"),
            message: t(hasUntracked ? "git.resetUntrackedConfirmation" : "git.resetTrackedConfirmation", { count }),
            buttons: [dialogButton(DialogButton.reset), dialogButton(DialogButton.cancel)],
        });
        if (choice === DialogButton.reset) void this.model.changes.resetChanges(changes);
    };

    private readonly doCommit = async (): Promise<void> => {
        const identity = await this.model.changes.getIdentity();
        const branch = this.branch;
        await showCommitDialog({
            branch,
            name: identity.name,
            email: identity.email,
            buttons: [DialogButton.commit, DialogButton.commitAndPush, DialogButton.cancel],
            onAction: async (result) => {
                if (result.button !== DialogButton.commit && result.button !== DialogButton.commitAndPush) return false;
                const newBranch = result.branch.trim() !== (branch ?? "")
                    ? result.branch.trim()
                    : undefined;
                const committed = await this.model.changes.commit(
                    result.message,
                    { name: result.name, email: result.email },
                    newBranch,
                );
                if (!committed) return false;
                if (result.button === DialogButton.commitAndPush) await this.model.branches.push();
                return true;
            },
        });
    };

    private commitButtonProps(stagedCount: number): Parameters<ButtonView["update"]>[0] {
        return {
            name: "git-commit",
            disabled: stagedCount === 0,
            onClick: this.doCommit,
            children: t("dialogs.buttonCommit"),
        };
    }

    private stageButtonProps(): Parameters<IconButtonView["update"]>[0] {
        return {
            name: "git-stage",
            size: "sm",
            title: t("git.stageSelected"),
            icon: "filter-arrow-down",
            disabled: !this.selUnstaged.length,
            onClick: () => this.move("unstaged", this.selUnstaged),
        };
    }

    private unstageButtonProps(): Parameters<IconButtonView["update"]>[0] {
        return {
            name: "git-unstage",
            size: "sm",
            title: t("git.unstageSelected"),
            icon: "filter-arrow-up",
            disabled: !this.selStaged.length,
            onClick: () => this.move("staged", this.selStaged),
        };
    }

    private updateControls(stagedCount: number): void {
        this.commitButton?.update(this.commitButtonProps(stagedCount));
        this.stageButton?.update(this.stageButtonProps());
        this.unstageButton?.update(this.unstageButtonProps());
    }

    private splitterProps(value: number): SplitterProps {
        return {
            name: "git-changes-splitter",
            orientation: "horizontal",
            value,
            onChange: this.handleChangeHeight,
            side: "after",
            border: "before",
        };
    }

    private readonly handleChangeHeight = (height: number): void => {
        const maxHeight = this.root.clientHeight * 0.85;
        this.bottomHeight = Math.max(60, Math.min(height, maxHeight || height));
        this.applyBottomHeight(this.bottomHeight);
        this.splitter?.update(this.splitterProps(this.bottomHeight));
    };

    private applyBottomHeight(height: number): void {
        if (this.stagedPanel) {
            applyPanelAttributes(this.stagedPanel, resolvePanelAttributes({
                name: "git-changes-staged",
                direction: "column",
                overflow: "hidden",
                shrink: false,
                height,
                minHeight: 60,
            }));
        }
    }

    /** Seed the bottom-panel default from the settled panel height, once. */
    private seedDefaultSplit(): void {
        this.schedule.settledLayout(this.root, () => {
            const height = this.root.clientHeight;
            if (height <= 0 || this.bottomHeight !== undefined) return;
            this.bottomHeight = Math.max(60, height * 0.5);
            this.applyBottomHeight(this.bottomHeight);
            this.splitter?.update(this.splitterProps(this.bottomHeight));
        });
    }
}
