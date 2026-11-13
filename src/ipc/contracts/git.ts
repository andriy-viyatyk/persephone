import type { TimeoutExemptions } from "../timeout-exemptions";
import type {
    GitAheadBehind,
    GitCommit,
    GitFetchOptions,
    GitFileChange,
    GitIdentity,
    GitLogOptions,
    GitMutationResult,
    GitProbeResult,
    GitPullOptions,
    GitPullResult,
    GitPushOptions,
    GitPushResult,
    GitRefs,
    GitRepoInfo,
    GitStatusResult,
    GitSwitchTarget,
} from "../git-ipc";

export interface GitApi {
    gitProbe: () => Promise<GitProbeResult>;
    gitDetectRepo: (dir: string) => Promise<GitRepoInfo | null>;
    gitLog: (dir: string, opts: GitLogOptions) => Promise<GitCommit[]>;
    gitShow: (dir: string, rev: string, path: string) => Promise<string>;
    gitStatus: (dir: string) => Promise<GitStatusResult>;
    gitCommitMessage: (dir: string, hash: string) => Promise<string>;
    gitCommitFiles: (dir: string, hash: string) => Promise<GitFileChange[]>;
    gitStage: (dir: string, paths: string[]) => Promise<GitMutationResult>;
    gitUnstage: (dir: string, paths: string[]) => Promise<GitMutationResult>;
    gitDiscard: (dir: string, trackedPaths: string[], untrackedPaths: string[]) => Promise<GitMutationResult>;
    gitCommit: (dir: string, message: string, identity?: GitIdentity) => Promise<GitMutationResult>;
    gitIdentity: (dir: string) => Promise<GitIdentity>;
    gitRefs: (dir: string) => Promise<GitRefs>;
    gitSwitch: (dir: string, target: GitSwitchTarget) => Promise<GitMutationResult>;
    gitCreateBranch: (dir: string, name: string, startPoint?: string, checkout?: boolean) => Promise<GitMutationResult>;
    gitFetch: (dir: string, opts?: GitFetchOptions) => Promise<GitMutationResult>;
    gitAheadBehind: (dir: string) => Promise<GitAheadBehind>;
    gitPush: (dir: string, opts?: GitPushOptions) => Promise<GitPushResult>;
    gitPull: (dir: string, opts?: GitPullOptions) => Promise<GitPullResult>;
    gitRemoteUrl: (dir: string, remote: string) => Promise<string>;
}


export const gitTimeoutExemptions = {
    gitDiscard: "Git CLI work can exceed the renderer request deadline.",
    gitCommit: "Git CLI work can exceed the renderer request deadline.",
    gitRemoteUrl: "Git CLI work can exceed the renderer request deadline.",
    gitProbe: "Git CLI work can exceed the renderer request deadline.",
    gitSwitch: "Git CLI work can exceed the renderer request deadline.",
    gitUnstage: "Git CLI work can exceed the renderer request deadline.",
    gitFetch: "Remote Git work can exceed the renderer request deadline.",
    gitLog: "Git CLI work can exceed the renderer request deadline.",
    gitIdentity: "Git CLI work can exceed the renderer request deadline.",
    gitShow: "Git CLI work can exceed the renderer request deadline.",
    gitStatus: "Git CLI work can exceed the renderer request deadline.",
    gitCommitFiles: "Git CLI work can exceed the renderer request deadline.",
    gitPull: "Remote Git work can exceed the renderer request deadline.",
    gitCommitMessage: "Git CLI work can exceed the renderer request deadline.",
    gitStage: "Git CLI work can exceed the renderer request deadline.",
    gitPush: "Remote Git work can exceed the renderer request deadline.",
    gitCreateBranch: "Git CLI work can exceed the renderer request deadline.",
    gitAheadBehind: "Remote Git work can exceed the renderer request deadline.",
    gitRefs: "Git CLI work can exceed the renderer request deadline.",
    gitDetectRepo: "Git CLI work can exceed the renderer request deadline.",
} satisfies TimeoutExemptions<GitApi>;
