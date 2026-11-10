/**
 * Shared DTOs for git integration.
 *
 * Plain data types crossing the main↔renderer IPC boundary for the git
 * request/response endpoints (`gitProbe`, `gitDetectRepo`). No main-only
 * dependencies live here so both `api-types.ts` (renderer-facing) and
 * `git-service.ts` (main) can import them.
 */

/** Result of the `git --version` availability probe (settings page). */
export interface GitProbeResult {
    installed: boolean;
    version?: string; // e.g. "2.43.0"
}

/** Repo membership for a directory. */
export interface GitRepoInfo {
    /** Absolute repo top-level (forward-slashed by git). */
    root: string;
    /** Current branch, or "HEAD" when detached / no commits yet. */
    branch: string;
}

/** Options for a `git log` query. */
export interface GitLogOptions {
    /** Cap on commits returned; the limit keeps each load bounded. Default 500.
     *  `0` (or negative) means no limit — load all commits. */
    maxCount?: number;
    /** Skip the first N commits — pagination for "load more". */
    skip?: number;
    /** Limit history to a single file (repo-relative or absolute), via `--follow`. */
    file?: string;
    /** Walk ALL refs (`git log --all`), not just HEAD — so the whole-repo Git Tree
     *  shows every branch's commits (like Git Extensions) even when HEAD is behind
     *  another branch. Omit/false for file-scoped history. */
    all?: boolean;
}

/** Kind of a decoration ref, used to color its label. */
export type GitRefKind = "head" | "branch" | "remote" | "tag";

/** A decoration ref at a commit (the prefix is parsed off into `kind`). */
export interface GitRef {
    /** Display name (e.g. "main", "v1.0", "origin/main"). */
    name: string;
    kind: GitRefKind;
}

/** One changed file in `git status`. */
export interface GitFileChange {
    /** Repo-relative path, forward-slashed. */
    path: string;
    /** Single-letter status code: M(odified) A(dded) D(eleted) R(enamed)
     *  C(opied) U(nmerged) ?(untracked). See `git-service.status()`. */
    status: string;
    /** Original path for renames/copies (R/C), forward-slashed. */
    oldPath?: string;
}

/** Result of a mutating git op. Never thrown across IPC —
 *  `ok:false` + message lets the renderer surface failure without a crash. */
export interface GitMutationResult {
    ok: boolean;
    error?: string;
}

/** Git author identity. Empty strings when unset in git config. */
export interface GitIdentity {
    name: string;
    email: string;
}

/** Target of a `git switch`. The renderer builds this from a
 *  clicked commit row or refs-panel node; the service maps it to a `git switch` form. */
export type GitSwitchTarget =
    | { type: "branch"; name: string }   // local branch → `git switch <name>`
    | { type: "remote"; ref: string }    // full remote ref "origin/feature/x" → tracking branch
    | { type: "commit"; hash: string }   // detached HEAD at a commit
    | { type: "tag"; name: string };     // detached HEAD at a tag

/** Split working-tree status for a repo. */
export interface GitStatusResult {
    /** Index (staged) changes. */
    staged: GitFileChange[];
    /** Working-tree (unstaged) changes, including untracked ('?'). */
    unstaged: GitFileChange[];
    /** Current branch name (simple-git status `.current`), or undefined when
     *  detached / no commits yet. */
    branch?: string;
}

/** Repository refs for the Git Tree "Branches & Tags" panel. */
export interface GitRefs {
    /** Current branch name (HEAD), or undefined when detached / no commits. */
    current?: string;
    /** Local branch names, e.g. "main", "feature/x". */
    localBranches: string[];
    /** Configured remote names, e.g. ["origin", "upstream"]. */
    remotes: string[];
    /** Remote-tracking branch names incl. remote prefix, e.g. "origin/main",
     *  "origin/feature/x". Excludes the symbolic "origin/HEAD". */
    remoteBranches: string[];
    /** Tag names, e.g. "v1.0.0". */
    tags: string[];
}

/** Options for `git fetch`. */
export interface GitFetchOptions {
    /** Fetch only this remote; omit → fetch all remotes (`--all`). */
    remote?: string;
}

/** Ahead/behind counts for the current branch vs its upstream.
 *  `hasUpstream: false` when the branch has no configured upstream — not an error. */
export interface GitAheadBehind {
    ahead: number;
    behind: number;
    /** Full upstream ref, e.g. "origin/main". Present only when `hasUpstream` is true. */
    upstream?: string;
    hasUpstream: boolean;
}

/** Options for `git push`. */
export interface GitPushOptions {
    /** Remote name. Defaults to "origin" (or the sole configured remote). */
    remote?: string;
    /** Local branch to push. Defaults to the current branch. */
    branch?: string;
    /** Pass `-u` to set the upstream tracking reference (first push of a new branch). */
    setUpstream?: boolean;
}

/** Result of a `git push` operation. Extends `GitMutationResult`
 *  with a rejection flag for non-fast-forward pushes. */
export interface GitPushResult {
    ok: boolean;
    error?: string;
    /** True when git rejected the push because the remote has commits the local
     *  branch does not — the user must fetch/pull before pushing. Never auto-force. */
    rejected?: boolean;
}

/** Options for `git pull`. */
export interface GitPullOptions {
    /** When true, pull with `--rebase` instead of merge. */
    rebase?: boolean;
    /** When true, pull with `--ff-only` (fails if a non-fast-forward merge is needed). */
    ffOnly?: boolean;
}

/** Result of a `git pull` operation. */
export interface GitPullResult {
    ok: boolean;
    error?: string;
    /** True when the pull failed because it left merge conflicts in the working tree. */
    hadConflicts?: boolean;
    /** Repo-relative paths of conflicted files (when `hadConflicts` is true). */
    conflicts?: string[];
    /** Human-readable summary from git (e.g. "Already up to date."). */
    summary?: string;
}

/** One commit row from `git log --topo-order`. */
export interface GitCommit {
    /** Full 40-char hash. */
    hash: string;
    /** Abbreviated hash for display (first 7). */
    shortHash: string;
    /** Parent hashes in order — parents[0] is the first parent. */
    parents: string[];
    /** First line of the commit message. */
    subject: string;
    authorName: string;
    /** Author email (`%ae`) — shown in the Git Tree "Commit" panel. */
    authorEmail: string;
    /** Commit (author) date as epoch ms. */
    authorDate: number;
    /** Decoration refs at this commit (branch/tag/HEAD), classified by kind. */
    refs: GitRef[];
}
