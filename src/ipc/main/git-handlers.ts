import type { GitIdentity, GitSwitchTarget } from "../git-ipc";
import type { GitApi } from "../contracts/git";
import { bindDomain } from "./endpoint-registry";
import * as gitService from "../../main/git-service";



export function initGitHandlers(): void {
    bindDomain<GitApi>({
        gitProbe: async () => gitService.probeGit(),
        gitDetectRepo: async (_event, dir: string) => gitService.detectRepo(dir),
        gitLog: async (_event, dir: string, options) => gitService.log(dir, options),
        gitShow: async (_event, dir: string, rev: string, path: string) =>
            gitService.show(dir, rev, path),
        gitStatus: async (_event, dir: string) => gitService.status(dir),
        gitCommitMessage: async (_event, dir: string, hash: string) =>
            gitService.commitMessage(dir, hash),
        gitCommitFiles: async (_event, dir: string, hash: string) =>
            gitService.commitFiles(dir, hash),
        gitStage: async (_event, dir: string, paths: string[]) =>
            gitService.stage(dir, paths),
        gitUnstage: async (_event, dir: string, paths: string[]) =>
            gitService.unstage(dir, paths),
        gitDiscard: async (_event, dir: string, trackedPaths: string[], untrackedPaths: string[]) =>
            gitService.discard(dir, trackedPaths, untrackedPaths),
        gitCommit: async (_event, dir: string, message: string, identity?: GitIdentity) =>
            gitService.commit(dir, message, identity),
        gitIdentity: async (_event, dir: string) => gitService.getIdentity(dir),
        gitRefs: async (_event, dir: string) => gitService.refs(dir),
        gitSwitch: async (_event, dir: string, target: GitSwitchTarget) =>
            gitService.switchTo(dir, target),
        gitCreateBranch: async (_event, dir: string, name: string, startPoint?: string, checkout?: boolean) =>
            gitService.createBranch(dir, name, startPoint, checkout),
        gitFetch: async (_event, dir: string, options) => gitService.fetch(dir, options),
        gitAheadBehind: async (_event, dir: string) => gitService.aheadBehind(dir),
        gitPush: async (_event, dir: string, options) => gitService.push(dir, options),
        gitPull: async (_event, dir: string, options) => gitService.pull(dir, options),
        gitRemoteUrl: async (_event, dir: string, remote: string) =>
            gitService.remoteUrl(dir, remote),
    });
}
