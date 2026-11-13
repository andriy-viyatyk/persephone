import { app } from "../../api/app";
import { createLinkData } from "../../../shared/link-data";
import { fpExtname, fpJoin } from "../../core/utils/file-path";
import { getLanguageByExtension } from "../../core/utils/language-mapping";
import type { GitCommit, GitFileChange } from "../../../ipc/git-ipc";
import {
    CommitDiffPanelModel,
    defaultCommitDiffPanelState,
    type CommitDiffPanelProps,
    type CommitDiffPanelState,
} from "./CommitDiffPanelModel";
import type { ILinkDiffRevision } from "../../api/types/io.link-data";
import type { MenuItem } from "../../uikit/Menu";
import { createComponentModelDriver, type ComponentModelDriver } from "../../core/state/model";
import { createPanelElement, applyPanelAttributes, resolvePanelAttributes } from "../../uikit/Panel/panel-style";
import { createTextElement } from "../../uikit/Text/text-style";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { FileListView } from "../../components/file-list/FileListView";
import type { FileListItem, FileListProps } from "../../components/file-list/FileList";
import type { GitTreeModel } from "../../components/git-tree/GitTreeModel";
import { gitStatusMeta } from "../../components/git-tree/git-status-meta";
import { SplitterView } from "../../uikit/Splitter/SplitterView";
import { MonacoDiffEditorHostView } from "../shared/MonacoDiffEditorHostView";
import "../../uikit/Panel/Panel.css";
import "../../uikit/Text/Text.css";
import "../../components/file-list/FileList.css";
import "../../components/git-tree/GitTree.css";
import { t } from "../../../shared/i18n/t";

export type { CommitDiffPanelProps } from "./CommitDiffPanelModel";

type CommitDiffDriver = ComponentModelDriver<CommitDiffPanelState, CommitDiffPanelProps, CommitDiffPanelModel>;

export class CommitDiffPanelView extends VanillaView<CommitDiffPanelProps> {
    private readonly driver: CommitDiffDriver;
    private readonly filePanel: HTMLDivElement;
    private readonly viewPanel: HTMLDivElement;
    private emptyDiffPanel: HTMLDivElement | undefined;
    /** The "select a commit" placeholder, kept so building the commit surface can
     *  drop it — the surface panels are appended, not replaced in. */
    private placeholder: HTMLSpanElement | undefined;
    private fileList: FileListView | undefined;
    private splitter: SplitterView | undefined;
    private diffHost: MonacoDiffEditorHostView | undefined;

    private gitTreeStateUnsubscribe: (() => void) | undefined;
    private boundGitTree: GitTreeModel | undefined;
    private itemsChanges: GitFileChange[] | undefined;
    private itemsCache: FileListItem[] = [];
    private mapChanges: GitFileChange[] | undefined;
    private changeMap = new Map<string, GitFileChange>();
    private appliedDiff: { before: string; after: string } | undefined;
    private appliedSelectedFile: string | undefined;

    public constructor(props: CommitDiffPanelProps) {
        super(props, createPanelElement({ name: "commit-diff", direction: "row", flex: 1, overflow: "hidden" }));
        this.filePanel = createPanelElement({
            name: "commit-diff-files",
            direction: "column",
            width: props.listWidth,
            shrink: false,
            overflow: "hidden",
        });
        this.viewPanel = createPanelElement({
            name: "commit-diff-view",
            direction: "column",
            flex: 1,
            overflow: "hidden",
        });
        this.driver = createComponentModelDriver(props, CommitDiffPanelModel, defaultCommitDiffPanelState);
        this.own(() => this.driver.dispose());
    }

    protected onMount(): void {
        this.driver.mount();
        this.own(() => {
            this.gitTreeStateUnsubscribe?.();
            this.gitTreeStateUnsubscribe = undefined;
            this.boundGitTree = undefined;
        });
        this.rebindGitTree(this.props.gitTree);
        this.bind(this.driver.model.state, (state) => ({
            changes: state.changes,
            selectedFile: state.selectedFile,
            diff: state.diff,
        }), this.applyState);
    }

    protected onUpdate(props: CommitDiffPanelProps): void {
        this.driver.update(props);
        if (props.gitTree !== this.boundGitTree) this.rebindGitTree(props.gitTree);
        this.onCommitsChanged(props.gitTree.state.get().commits);
        this.applyState(this.driver.model.state.get());
    }

    private rebindGitTree(source: GitTreeModel): void {
        if (source === this.boundGitTree) return;
        this.gitTreeStateUnsubscribe?.();
        this.gitTreeStateUnsubscribe = undefined;
        this.boundGitTree = source;
        this.gitTreeStateUnsubscribe = this.ownSubscription(source.state.subscribe(
            () => this.onCommitsChanged(source.state.get().commits),
            (state) => state.commits,
        ));
        this.onCommitsChanged(source.state.get().commits);
    }

    private onCommitsChanged(commits: GitCommit[]): void {
        const commit = this.currentCommit(commits);
        this.driver.model.loadCommit(this.props.repoRoot, commit);
    }

    private readonly applyState = (state: CommitDiffPanelState): void => {
        this.changeMapFor(state.changes);
        const commit = this.currentCommit();
        if (!commit) {
            this.releaseCommitSurface();
            applyPanelAttributes(this.root, resolvePanelAttributes({ padding: "md", align: "center", justify: "center", flex: 1 }));
            this.placeholder = createTextElement(t("git.selectCommitChanges"), { color: "light" });
            this.root.replaceChildren(this.placeholder);
            return;
        }
        this.placeholder?.remove();
        this.placeholder = undefined;

        applyPanelAttributes(this.root, resolvePanelAttributes({ name: "commit-diff", direction: "row", flex: 1, overflow: "hidden" }));
        this.ensureCommitSurface(state);
        applyPanelAttributes(this.filePanel, resolvePanelAttributes({
            name: "commit-diff-files",
            direction: "column",
            width: this.props.listWidth,
            shrink: false,
            overflow: "hidden",
        }));
        this.fileList?.update(this.fileListProps(state));
        this.ensureDiffHost(state.selectedFile, state.diff);
        if (!this.diffHost || !state.selectedFile) return;
        this.diffHost.setDiffValues(state.diff.before, state.diff.after);
        this.diffHost.setLanguage(this.languageFor(state.selectedFile));
        if (this.appliedDiff !== state.diff || this.appliedSelectedFile !== state.selectedFile) {
            const editor = this.diffHost.getEditor();
            editor.getOriginalEditor().setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
            editor.getModifiedEditor().setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
        }
        this.appliedDiff = state.diff;
        this.appliedSelectedFile = state.selectedFile;
    };

    private ensureCommitSurface(state: CommitDiffPanelState): void {
        if (!this.fileList) {
            this.fileList = this.child(new FileListView(this.fileListProps(state)));
            this.filePanel.append(this.fileList.root);
            this.fileList.mount();
        }
        if (!this.splitter) {
            this.splitter = this.child(new SplitterView({
                name: "commit-diff-splitter",
                orientation: "vertical",
                value: this.props.listWidth,
                onChange: this.props.onListWidthChange,
                side: "before",
                border: "after",
                min: 140,
            }));
            this.root.append(this.filePanel, this.splitter.root, this.viewPanel);
            this.splitter.mount();
        } else if (!this.root.contains(this.filePanel)) {
            this.root.append(this.filePanel, this.splitter.root, this.viewPanel);
        }
        this.splitter.update({
            name: "commit-diff-splitter",
            orientation: "vertical",
            value: this.props.listWidth,
            onChange: this.props.onListWidthChange,
            side: "before",
            border: "after",
            min: 140,
        });
    }

    private ensureDiffHost(selectedFile: string | undefined, diff: { before: string; after: string }): void {
        if (!selectedFile) {
            if (this.diffHost) {
                this.releaseChild(this.diffHost);
                this.diffHost = undefined;
            }
            this.showDiffPlaceholder();
            return;
        }
        if (!this.diffHost) {
            this.diffHost = this.child(new MonacoDiffEditorHostView({
                language: this.languageFor(selectedFile),
                initialOriginal: diff.before,
                initialModified: diff.after,
                options: {
                    readOnly: true,
                    originalEditable: false,
                    renderSideBySide: false,
                    automaticLayout: true,
                },
            }));
            this.viewPanel.replaceChildren(this.diffHost.root);
            this.diffHost.mount();
        } else if (!this.viewPanel.contains(this.diffHost.root)) {
            this.viewPanel.replaceChildren(this.diffHost.root);
        }
    }

    private showDiffPlaceholder(): void {
        if (!this.emptyDiffPanel) {
            this.emptyDiffPanel = createPanelElement({ padding: "md", align: "center", justify: "center", flex: 1 });
        }
        this.emptyDiffPanel.replaceChildren(createTextElement(
            this.driver.model.state.get().changes.length === 0
                ? t("git.noFileChangesInCommit")
                : t("git.selectFileForDiff"),
            { color: "light" },
        ));
        this.viewPanel.replaceChildren(this.emptyDiffPanel);
    }

    private releaseCommitSurface(): void {
        if (this.diffHost) {
            this.releaseChild(this.diffHost);
            this.diffHost = undefined;
        }
        if (this.fileList) {
            this.releaseChild(this.fileList);
            this.fileList = undefined;
        }
        if (this.splitter) {
            this.releaseChild(this.splitter);
            this.splitter = undefined;
        }
        this.filePanel.remove();
        this.viewPanel.remove();
        this.emptyDiffPanel = undefined;
        this.appliedDiff = undefined;
        this.appliedSelectedFile = undefined;
    }

    private fileListProps(state: CommitDiffPanelState): FileListProps {
        return {
            items: this.itemsFor(state.changes),
            onClick: this.handleFileClick,
            getTrailing: this.getTrailing,
            getContextMenu: this.getContextMenu,
            selectedPath: state.selectedFile,
            compact: true,
        };
    }

    private itemsFor(changes: GitFileChange[]): FileListItem[] {
        if (changes !== this.itemsChanges) {
            this.itemsChanges = changes;
            this.itemsCache = changes.map((change) => ({ filePath: change.path, title: change.path }));
        }
        return this.itemsCache;
    }

    private changeMapFor(changes: GitFileChange[]): Map<string, GitFileChange> {
        if (changes !== this.mapChanges) {
            this.mapChanges = changes;
            this.changeMap = new Map(changes.map((change) => [change.path, change]));
        }
        return this.changeMap;
    }

    private readonly getTrailing = (item: FileListItem): Node | null => {
        const change = this.changeMap.get(item.filePath);
        if (!change) return null;
        const meta = gitStatusMeta(change.status);
        const badge = document.createElement("span");
        badge.className = "git-status-badge";
        badge.dataset.type = "git-status-badge";
        badge.title = change.status;
        badge.style.color = meta.hex;
        badge.textContent = meta.letter;
        return badge;
    };

    private readonly handleFileClick = (item: FileListItem): void => {
        this.driver.model.selectFile(item.filePath);
    };

    private readonly getContextMenu = (item: FileListItem): MenuItem[] => {
        const change = this.changeMap.get(item.filePath);
        const commit = this.currentCommit();
        if (!change || !commit) return [];
        this.driver.model.selectFile(item.filePath);
        return [{
            id: "open-in-new-tab",
            label: t("shell.openInNewTab"),
            icon: "compare",
            onClick: () => this.openInNewTab(change),
        }];
    };

    private readonly openInNewTab = (change: GitFileChange): void => {
        const commit = this.currentCommit();
        if (!commit) return;
        const parent = commit.parents[0] ?? "";
        const diffFrom: ILinkDiffRevision = parent
            ? { kind: "commit", hash: parent, shortHash: parent.slice(0, 7) }
            : { kind: "commit", hash: "", shortHash: "" };
        const diffTo: ILinkDiffRevision = {
            kind: "commit",
            hash: commit.hash,
            shortHash: commit.shortHash,
        };
        void app.events.openRawLink.sendAsync(
            createLinkData(fpJoin(this.props.repoRoot, change.path), {
                target: "file-diff",
                diffFrom,
                diffTo,
            }),
        );
    };

    private languageFor(filePath: string | undefined): string | undefined {
        if (!filePath) return undefined;
        const extension = fpExtname(filePath);
        return extension ? getLanguageByExtension(extension)?.id : undefined;
    }

    private currentCommit(commits = this.props.gitTree.state.get().commits) {
        return commits.find((commit) => commit.hash === this.props.selectedHash);
    }
}
