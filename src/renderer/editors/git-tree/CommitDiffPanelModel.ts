import { git } from "../../api/git";
import type { GitCommit, GitFileChange } from "../../../ipc/git-ipc";
import type { GitTreeModel } from "../../components/git-tree/GitTreeModel";
import { TComponentModel } from "../../core/state/model";

export interface CommitDiffPanelProps {
    repoRoot: string;
    gitTree: GitTreeModel;
    selectedHash?: string;
    listWidth: number;
    onListWidthChange: (width: number) => void;
}

export interface CommitDiffPanelState {
    changes: GitFileChange[];
    selectedFile: string | undefined;
    diff: { before: string; after: string };
}

export const defaultCommitDiffPanelState: CommitDiffPanelState = {
    changes: [],
    selectedFile: undefined,
    diff: { before: "", after: "" },
};

export class CommitDiffPanelModel extends TComponentModel<CommitDiffPanelState, CommitDiffPanelProps> {
    private filesKey: string | undefined;
    private filesGeneration = 0;
    private diffKey: string | undefined;
    private diffGeneration = 0;
    private live = true;
    private commit: GitCommit | undefined;

    loadCommit(repoRoot: string, commit: GitCommit | undefined): void {
        this.commit = commit;
        const key = `${this.props.repoRoot}\u0000${this.props.selectedHash ?? ""}\u0000${commit?.hash ?? ""}`;
        if (key === this.filesKey) return;
        this.filesKey = key;
        const generation = ++this.filesGeneration;
        // A commit/repository change also invalidates an in-flight diff request. The file
        // request will start the replacement diff after its selected path is known.
        this.diffGeneration++;
        this.diffKey = undefined;
        if (!commit) {
            this.setFiles([]);
            this.loadDiff();
            return;
        }
        void git.commitFiles(repoRoot, commit.hash).then((changes) => {
            if (!this.live || generation !== this.filesGeneration || key !== this.filesKey) return;
            this.setFiles(changes);
            this.loadDiff();
        });
    }

    selectFile(path: string): void {
        this.setSelectedFile(path);
        this.loadDiff();
    }

    private setFiles = (changes: GitFileChange[]): void => {
        this.state.update((state) => {
            state.changes = changes;
            state.selectedFile = changes[0]?.path;
        });
    };

    private setSelectedFile = (selectedFile: string | undefined): void => {
        this.state.update((state) => { state.selectedFile = selectedFile; });
    };

    private setDiff = (diff: { before: string; after: string }): void => {
        this.state.update((state) => { state.diff = diff; });
    };

    private loadDiff(): void {
        const commit = this.commit;
        const { changes, selectedFile } = this.state.get();
        const change = changes.find((item) => item.path === selectedFile);
        const key = commit && selectedFile && change
            ? `${this.props.repoRoot}\u0000${commit.hash}\u0000${selectedFile}\u0000${change.oldPath ?? ""}\u0000${change.status}`
            : `${this.props.repoRoot}\u0000`;
        if (key === this.diffKey) return;
        this.diffKey = key;
        const generation = ++this.diffGeneration;
        if (!commit || !selectedFile || !change) {
            this.setDiff({ before: "", after: "" });
            return;
        }
        const parent = commit.parents[0] ?? "";
        const beforePath = change.oldPath ?? selectedFile;
        void Promise.all([
            parent ? git.show(this.props.repoRoot, parent, beforePath) : Promise.resolve(""),
            git.show(this.props.repoRoot, commit.hash, selectedFile),
        ]).then(([before, after]) => {
            if (!this.live || generation !== this.diffGeneration || key !== this.diffKey) return;
            this.setDiff({ before, after });
        });
    }

    dispose(): void {
        this.live = false;
        this.filesGeneration++;
        this.diffGeneration++;
        super.dispose();
    }
}
