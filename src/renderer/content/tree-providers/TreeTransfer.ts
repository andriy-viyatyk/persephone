import type { ILink, ITreeProvider } from "../../api/types/io.tree";
import type { IProviderWrite } from "../../api/types/io.provider";
import { pipeFromLink } from "../rebuild-pipe";
import { MAX_BOARD_PIPE_CHUNK_BYTES, MAX_BUFFERED_PIPE_BYTES } from "../../../shared/board-pipe-constants";
import { errMessage } from "../../../shared/utils";
import { treeTransferCapability, type TransferEntry, type TransferNodeKind, type TreeTransferCapability } from "./tree-provider-capabilities";

export type TreeConflictAction = "overwrite" | "skip" | "keep-both";
export interface TreeTransferConflict {
    source: ILink;
    destinationPath: string;
    sourceKind: TransferNodeKind;
    destinationKind: TransferNodeKind;
}
export interface TreeTransferConflictChoice { action: TreeConflictAction; applyToAll: boolean }
export interface TreeTransferProgress {
    filesDone: number;
    filesTotal?: number;
    bytesDone: number;
    bytesTotal?: number;
    currentName: string;
}
export interface TreeTransferItemResult {
    source: ILink;
    destinationPath?: string;
    status: "copied" | "moved" | "skipped" | "failed" | "cancelled" | "copied-not-deleted";
    failures: string[];
}
export interface TreeTransferResult {
    items: TreeTransferItemResult[];
    copied: number;
    errors: string[];
}
export interface TreeTransferOptions {
    move?: boolean;
    signal?: AbortSignal;
    onConflict?: (conflict: TreeTransferConflict) => Promise<TreeTransferConflictChoice> | TreeTransferConflictChoice;
    onProgress?: (progress: TreeTransferProgress) => void;
}

export interface TreeTransferSource { provider: ITreeProvider; items: ILink[] }
export interface TreeTransferTarget { provider: ITreeProvider; folderPath: string }
interface PlannedNode { entry: TransferEntry; children: PlannedNode[]; skipped: boolean }
interface PlannedItem { entry?: TransferEntry; tree?: PlannedNode; result: TreeTransferItemResult; complete: boolean }

function checkSignal(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("Transfer cancelled.");
}

function isDirectory(kind: TransferNodeKind): boolean {
    return kind === "directory" || kind === "directory-symlink";
}

function sameKind(source: TransferNodeKind, destination: TransferNodeKind): boolean {
    return isDirectory(source) === isDirectory(destination);
}

function compareInside(capability: TreeTransferCapability, parent: string, child: string): boolean {
    const result = capability.isInside(parent, child);
    if (result === undefined) throw new Error("Tree provider cannot prove path containment safely.");
    return result;
}

export class TreeTransfer {
    /** Copy or move selected links between supported live tree providers. */
    async transfer(source: TreeTransferSource, target: TreeTransferTarget, options: TreeTransferOptions = {}): Promise<TreeTransferResult> {
        const sourceCapability = treeTransferCapability(source.provider);
        const targetCapability = treeTransferCapability(target.provider);
        if (!sourceCapability || !targetCapability) throw new Error("Tree transfer is supported only for local and board trees.");
        if (!target.provider.writable) throw new Error("The destination tree is read-only.");
        if (source.provider.type === "archive" || target.provider.type === "archive") throw new Error("Archive trees cannot participate in transfers.");
        const targetFolder = await targetCapability.stat(target.folderPath);
        if (!targetFolder.stat.exists || !isDirectory(targetFolder.kind) || targetFolder.kind === "directory-symlink") {
            throw new Error("The destination folder does not exist or is not a safe directory.");
        }
        const results: TreeTransferItemResult[] = [];
        const planned: PlannedItem[] = [];
        const selectedPaths: Array<{ path: string; item: ILink; index: number }> = [];
        for (const item of source.items) {
            if (options.signal?.aborted) {
                const result = { source: item, status: "cancelled" as const, failures: ["Transfer cancelled."] };
                results.push(result); planned.push({ result, complete: false }); continue;
            }
            let path: string;
            try { path = sourceCapability.pathForLink(item); }
            catch (error: unknown) {
                const result = { source: item, status: "failed" as const, failures: [errMessage(error)] };
                results.push(result); planned.push({ result, complete: false }); continue;
            }
            let redundant: typeof selectedPaths[number] | undefined;
            let contained: typeof selectedPaths = [];
            try {
                redundant = selectedPaths.find(({ path: prior }) => prior === path || compareInside(sourceCapability, prior, path));
                if (!redundant) {
                    contained = selectedPaths.filter(({ path: prior }) => prior !== path && compareInside(sourceCapability, path, prior));
                }
            } catch (error: unknown) {
                const result = { source: item, status: "failed" as const, failures: [errMessage(error)] };
                results.push(result); planned.push({ result, complete: false }); continue;
            }
            if (redundant) {
                const result = { source: item, status: "skipped" as const, failures: ["Redundant selection; an ancestor is already selected."] };
                results.push(result); planned.push({ result, complete: false }); continue;
            }
            for (const selected of contained) {
                const prior = planned[selected.index];
                if (!prior) continue;
                prior.result.status = "skipped";
                prior.result.failures.push("Redundant selection; an ancestor is selected.");
                prior.complete = false;
                selectedPaths.splice(selectedPaths.indexOf(selected), 1);
            }
            selectedPaths.push({ path, item, index: planned.length });
            const result = { source: item, status: "failed" as const, failures: [] as string[] };
            results.push(result);
            const plan: PlannedItem = { result, complete: false };
            planned.push(plan);
            try {
                const { stat, kind } = await sourceCapability.stat(path);
                if (!stat.exists) throw new Error(`Source item no longer exists: ${path}`);
                const entry: TransferEntry = { link: item, path, name: item.title, kind, size: stat.size };
                plan.entry = entry;
                if (isDirectory(kind) && sourceCapability.backingStoreKey === targetCapability.backingStoreKey
                    && compareInside(sourceCapability, path, target.folderPath)) {
                    throw new Error("A folder cannot be copied into itself or one of its descendants.");
                }
                plan.tree = await this.walk(sourceCapability, entry, options.signal);
                if (options.move && !this.hasSkipped(plan.tree) && !this.hasSafeDeletion(sourceCapability, plan.tree)) {
                    throw new Error("The source tree does not declare safe deletion semantics for this item or a descendant.");
                }
                plan.complete = !this.hasSkipped(plan.tree);
                if (plan.tree.skipped) {
                    plan.result.status = "skipped";
                    plan.result.failures.push(`Skipped unsupported directory link: ${path}`);
                }
            } catch (error: unknown) {
                if (options.signal?.aborted) plan.result.status = "cancelled";
                plan.result.failures.push(errMessage(error));
                plan.complete = false;
            }
        }

        const totals = this.trustworthyTotals(planned);
        let filesDone = 0;
        let bytesDone = 0;
        let applyToAll: TreeConflictAction | undefined;
        for (const plan of planned) {
            if (!plan.entry || !plan.tree || plan.result.status === "skipped" || plan.result.failures.length) continue;
            if (options.signal?.aborted) {
                plan.result.status = "cancelled";
                plan.result.failures.push("Transfer cancelled.");
                continue;
            }
            try {
                const state = { filesDone, bytesDone, applyToAll, failures: [] as string[] };
                const copied = await this.copyNode(
                    plan.tree, source.provider, sourceCapability, target.provider, targetCapability,
                    target.folderPath, options, state,
                    totals,
                );
                filesDone = state.filesDone;
                bytesDone = state.bytesDone;
                applyToAll = state.applyToAll;
                plan.result.failures.push(...state.failures);
                if (copied.skipped) {
                    plan.complete = false;
                    plan.result.status = "skipped";
                } else {
                    plan.result.destinationPath = copied.destinationPath;
                    plan.complete = plan.complete && copied.complete;
                    plan.result.status = "copied";
                }
            } catch (error: unknown) {
                plan.complete = false;
                plan.result.status = options.signal?.aborted ? "cancelled" : "failed";
                plan.result.failures.push(errMessage(error));
            }
        }

        if (options.move && !options.signal?.aborted) {
            for (const plan of planned) {
                if (options.signal?.aborted) break;
                if (!plan.entry || !plan.tree || !plan.complete || plan.result.status !== "copied") continue;
                const mode = sourceCapability.deletionMode(plan.tree.entry);
                if (!mode) {
                    plan.result.status = "copied-not-deleted";
                    plan.result.failures.push("The source tree does not declare a safe deletion strategy.");
                    continue;
                }
                try {
                    const deletedPaths: string[] = [];
                    try {
                        await this.deleteTree(sourceCapability, plan.tree, mode, options.signal, deletedPaths);
                    } catch (error: unknown) {
                        const alreadyDeleted = deletedPaths.length ? ` Already deleted: ${deletedPaths.join(", ")}.` : "";
                        throw new Error(`${errMessage(error)}${alreadyDeleted}`, { cause: error });
                    }
                    plan.result.status = "moved";
                } catch (error: unknown) {
                    plan.result.status = "copied-not-deleted";
                    plan.result.failures.push(errMessage(error));
                }
            }
            if (options.signal?.aborted) {
                for (const plan of planned) {
                    if (plan.result.status === "copied") {
                        plan.result.status = "cancelled";
                        plan.result.failures.push("Source retained because the transfer was cancelled.");
                    }
                }
            }
        } else if (options.signal?.aborted) {
            for (const plan of planned) {
                if (plan.result.status === "copied") {
                    plan.result.status = "cancelled";
                    plan.result.failures.push("Source retained because the transfer was cancelled.");
                }
            }
        }

        const copied = filesDone;
        const errors = results.flatMap((item) => item.failures.map((failure) => `${item.source.title}: ${failure}`));
        return { items: results, copied, errors };
    }

    private async walk(capability: TreeTransferCapability, entry: TransferEntry, signal?: AbortSignal): Promise<PlannedNode> {
        checkSignal(signal);
        if (entry.kind === "directory-symlink") return { entry, children: [], skipped: true };
        if (!isDirectory(entry.kind)) return { entry, children: [], skipped: false };
        const children = await capability.listChildren(entry.path);
        const plannedChildren: PlannedNode[] = [];
        for (const child of children) {
            checkSignal(signal);
            const { stat, kind } = await capability.stat(child.path);
            if (!stat.exists) throw new Error(`Listed source item disappeared: ${child.path}`);
            const verified = { ...child, kind, size: stat.size };
            plannedChildren.push(await this.walk(capability, verified, signal));
        }
        return { entry, children: plannedChildren, skipped: false };
    }

    private hasSkipped(tree: PlannedNode): boolean {
        return tree.skipped || tree.children.some((child) => this.hasSkipped(child));
    }

    private hasSafeDeletion(capability: TreeTransferCapability, tree: PlannedNode): boolean {
        return capability.deletionMode(tree.entry) !== undefined
            && tree.children.every((child) => this.hasSafeDeletion(capability, child));
    }

    private trustworthyTotals(planned: PlannedItem[]): { filesTotal?: number; bytesTotal?: number } {
        const entries: TransferEntry[] = [];
        let known = true;
        const visit = (node?: PlannedNode): void => {
            if (!node || node.skipped) { known = false; return; }
            if (!isDirectory(node.entry.kind)) {
                entries.push(node.entry);
                if (!Number.isSafeInteger(node.entry.size) || node.entry.size! < 0) known = false;
            }
            node.children.forEach(visit);
        };
        planned.forEach((item) => visit(item.tree));
        const bytesTotal = entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
        return known && Number.isSafeInteger(bytesTotal) ? { filesTotal: entries.length, bytesTotal } : {};
    }

    private async copyNode(
        node: PlannedNode,
        sourceProvider: ITreeProvider,
        sourceCapability: TreeTransferCapability,
        targetProvider: ITreeProvider,
        targetCapability: TreeTransferCapability,
        targetFolder: string,
        options: TreeTransferOptions,
        state: { filesDone: number; bytesDone: number; applyToAll?: TreeConflictAction; failures: string[] },
        totals: { filesTotal?: number; bytesTotal?: number },
    ): Promise<{ destinationPath: string; complete: boolean; skipped: boolean }> {
        checkSignal(options.signal);
        if (node.skipped) return { destinationPath: "", complete: false, skipped: true };
        const name = node.entry.name;
        targetCapability.validateName(name);
        let destinationPath = targetCapability.joinChild(targetFolder, name);
        let destination = await targetCapability.stat(destinationPath);
        if (destination.stat.exists) {
            let action = state.applyToAll;
            if (!action) {
                const choice = options.onConflict
                    ? await options.onConflict({ source: node.entry.link, destinationPath, sourceKind: node.entry.kind, destinationKind: destination.kind })
                    : { action: "skip" as const, applyToAll: false };
                action = choice.action;
                if (choice.applyToAll) state.applyToAll = choice.action;
            }
            if (action === "skip") return { destinationPath, complete: false, skipped: true };
            if (action === "keep-both") {
                destinationPath = await this.keepBothPath(targetCapability, targetFolder, name, isDirectory(node.entry.kind));
                destination = await targetCapability.stat(destinationPath);
            } else if (destination.kind === "file-symlink" || destination.kind === "directory-symlink") {
                throw new Error("Overwriting a symbolic-link destination is not supported safely.");
            } else if (!sameKind(node.entry.kind, destination.kind)) {
                throw new Error(`Cannot overwrite a ${isDirectory(node.entry.kind) ? "file" : "folder"} with a ${isDirectory(destination.kind) ? "folder" : "file"}.`);
            }
        }
        if (isDirectory(node.entry.kind)) {
            if (!destination.stat.exists) {
                if (typeof targetProvider.mkdir !== "function") throw new Error("The destination tree cannot create folders.");
                await targetProvider.mkdir(destinationPath);
            }
            let complete = true;
            for (const child of node.children) {
                try {
                    const childResult = await this.copyNode(child, sourceProvider, sourceCapability, targetProvider, targetCapability, destinationPath, options, state, totals);
                    if (!childResult.complete) complete = false;
                } catch (error: unknown) {
                    if (options.signal?.aborted) throw error;
                    complete = false;
                    state.failures.push(`${child.entry.name}: ${errMessage(error)}`);
                }
            }
            return { destinationPath, complete, skipped: false };
        }
        await this.copyFile(sourceProvider, targetCapability, node.entry, destinationPath, options, state, totals);
        return { destinationPath, complete: true, skipped: false };
    }

    private async keepBothPath(capability: TreeTransferCapability, folder: string, name: string, directory: boolean): Promise<string> {
        const dot = !directory ? name.lastIndexOf(".") : -1;
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const extension = dot > 0 ? name.slice(dot) : "";
        for (let index = 1; ; index++) {
            const candidateName = `${stem} (${index})${extension}`;
            capability.validateName(candidateName);
            const candidate = capability.joinChild(folder, candidateName);
            const result = await capability.stat(candidate);
            if (!result.stat.exists) return candidate;
        }
    }

    private async copyFile(
        sourceProvider: ITreeProvider,
        targetCapability: TreeTransferCapability,
        entry: TransferEntry,
        destinationPath: string,
        options: TreeTransferOptions,
        state: { filesDone: number; bytesDone: number; applyToAll?: TreeConflictAction; failures: string[] },
        totals: { filesTotal?: number; bytesTotal?: number },
    ): Promise<void> {
        checkSignal(options.signal);
        const sourceHref = sourceProvider.resolveLink(entry.path);
        const destinationHref = await targetCapability.resolveContentHref(destinationPath);
        const sourcePipe = await pipeFromLink(sourceHref);
        let targetPipe: Awaited<ReturnType<typeof pipeFromLink>>;
        try {
            targetPipe = await pipeFromLink(destinationHref);
        } catch (error: unknown) {
            sourcePipe.dispose();
            throw error;
        }
        let session: IProviderWrite | undefined;
        let committed = false;
        let failure: unknown;
        let cleanupFailure: unknown;
        const bufferedChunks: Buffer[] = [];
        let bufferedLength = 0;
        try {
            if (sourcePipe.transformers.length || targetPipe.transformers.length) {
                throw new Error("Transformed content pipes are not supported for bounded tree transfers.");
            }
            if (!targetPipe.provider.beginWrite && !targetPipe.provider.writeBinary) {
                throw new Error("The destination content provider cannot write files.");
            }
            if (!sourcePipe.provider.stat) throw new Error("Source size is unavailable for bounded transfer.");
            const stat = await sourcePipe.stat({ signal: options.signal });
            if (!stat?.exists || !Number.isSafeInteger(stat.size) || stat.size! < 0) {
                throw new Error("Source size is unavailable or unsafe for bounded transfer.");
            }
            const size = stat.size!;
            if (size > MAX_BUFFERED_PIPE_BYTES && !sourcePipe.provider.createReadStream) {
                throw new Error(`Source exceeds the ${MAX_BUFFERED_PIPE_BYTES}-byte buffered transfer limit.`);
            }
            checkSignal(options.signal);
            session = await targetPipe.provider.beginWrite?.({ signal: options.signal });
            const write = async (chunk: Buffer): Promise<void> => {
                checkSignal(options.signal);
                if (session) await session.write(chunk);
                else {
                    bufferedLength += chunk.byteLength;
                    if (bufferedLength > MAX_BUFFERED_PIPE_BYTES) throw new Error("Buffered transfer exceeds the configured byte limit.");
                    bufferedChunks.push(chunk);
                }
                if (session) {
                    state.bytesDone += chunk.byteLength;
                    options.onProgress?.({ ...state, ...totals, currentName: entry.name });
                }
            };
            if (sourcePipe.provider.createReadStream) {
                let offset = 0;
                while (offset < size) {
                    checkSignal(options.signal);
                    const length = Math.min(MAX_BOARD_PIPE_CHUNK_BYTES, size - offset);
                    const stream = sourcePipe.provider.createReadStream({ start: offset, end: offset + length - 1 }, { signal: options.signal }) as NodeJS.ReadableStream & AsyncIterable<Uint8Array>;
                    const destroy = (): void => { (stream as NodeJS.ReadableStream & { destroy?: (error?: Error) => void }).destroy?.(); };
                    options.signal?.addEventListener("abort", destroy, { once: true });
                    let rangeBytes = 0;
                    try {
                        for await (const chunk of stream) {
                            const bytes = Buffer.from(chunk);
                            rangeBytes += bytes.byteLength;
                            if (rangeBytes > length) throw new Error("Source stream returned more bytes than requested.");
                            await write(bytes);
                        }
                    } finally { options.signal?.removeEventListener("abort", destroy); }
                    if (rangeBytes !== length) throw new Error("Source stream ended before the requested range was complete.");
                    offset += rangeBytes;
                }
                const finalStat = await sourcePipe.stat({ signal: options.signal });
                if (!finalStat?.exists || finalStat.size !== size) throw new Error("Source size changed during transfer.");
            } else {
                if (size > MAX_BUFFERED_PIPE_BYTES) throw new Error("Source has no ranged stream and exceeds the buffered transfer limit.");
                const bytes = await sourcePipe.readBinary({ signal: options.signal });
                if (bytes.byteLength !== size || bytes.byteLength > MAX_BUFFERED_PIPE_BYTES) throw new Error("Buffered source size changed or exceeded the configured limit.");
                await write(bytes);
            }
            checkSignal(options.signal);
            if (session) await session.commit();
            else {
                await targetPipe.writeBinary(Buffer.concat(bufferedChunks, bufferedLength));
                state.bytesDone += bufferedLength;
                options.onProgress?.({ ...state, ...totals, currentName: entry.name });
                checkSignal(options.signal);
            }
            committed = true;
            state.filesDone++;
            options.onProgress?.({ ...state, ...totals, currentName: entry.name });
        } catch (error: unknown) {
            failure = error;
        } finally {
            if (session && !committed) {
                try { await session.abort(); } catch (error: unknown) { cleanupFailure = error; }
            }
            sourcePipe.dispose();
            targetPipe.dispose();
        }
        if (failure && cleanupFailure) {
            throw new Error(`${errMessage(failure)}; write cleanup also failed: ${errMessage(cleanupFailure)}`, { cause: failure });
        }
        if (failure) throw failure;
        if (cleanupFailure) throw new Error(`Write cleanup failed: ${errMessage(cleanupFailure)}`, { cause: cleanupFailure });
    }

    private async deleteTree(
        capability: TreeTransferCapability,
        node: PlannedNode,
        mode: "recursive" | "empty-only",
        signal?: AbortSignal,
        deletedPaths: string[] = [],
    ): Promise<void> {
        checkSignal(signal);
        if (mode === "recursive") {
            await capability.deleteEntry(node.entry);
            deletedPaths.push(node.entry.path);
            return;
        }
        for (const child of node.children) {
            const childMode = capability.deletionMode(child.entry);
            if (!childMode) throw new Error(`Deletion semantics are unknown for ${child.entry.path}.`);
            await this.deleteTree(capability, child, childMode, signal, deletedPaths);
        }
        checkSignal(signal);
        await capability.deleteEntry(node.entry);
        deletedPaths.push(node.entry.path);
    }
}
