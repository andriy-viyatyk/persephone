import type { ICategorySegment, ILink, ITreeProvider, ITreeStat } from "../../api/types/io.tree";
import { moduleService } from "../../api/module-service";
import { ui } from "../../api/ui";
import { fpExtname } from "../../core/utils/file-path";
import type {
    ProviderResult,
    TreeProviderOperation,
    TreeProviderRequest,
} from "../../../ipc/module-service-channels";
import { BoardRoot } from "../../../shared/board/board-root";
import { isValidBoardTreePath } from "../../../shared/board/board-tree-path";
import { t } from "../../../shared/i18n/t";
import { boardSchemeOwner, schemeOf } from "../scheme-registry";
import {
    acceptedBoardProviderOwner,
    MissingProviderError,
    ProviderUnavailableError,
    providerDeclarationFor,
    subscribeProviderAvailability,
    whenProviderDeclarationsReady,
} from "../registry";
import { encodeCategoryLink } from "./tree-provider-link";
import { boardTreeSourceIdentity } from "./tree-provider-identity";
import {
    invalidProviderResult,
    mapProviderRequestError,
    ProviderOperationError,
    providerResultError,
} from "../providers/proxy-provider-errors";

interface AcceptedProvider {
    boardRoot: string;
    schemes: readonly string[];
}

function validateRootPath(rootPath: string): void {
    if (!isValidBoardTreePath(rootPath) || !BoardRoot.tryFrom(rootPath)) {
        throw new TypeError("A board tree root must be an absolute path.");
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hrefKey(href: string): string {
    return href;
}

/** Tree view over a trusted board's accepted tree provider. */
export class ProxyTreeProvider implements ITreeProvider {
    readonly sourceUrl: string;
    readonly rootPath: string;
    readonly navigable = true;
    readonly hasTags = false;
    readonly hasHostnames = false;
    readonly pinnable = false;

    private readonly hrefToPath = new Map<string, string>();
    private readonly pathToHref = new Map<string, string>();
    private readonly truncatedPaths = new Set<string>();
    private readonly requests = new Set<AbortController>();
    private readonly unsubscribeAvailability: () => void;
    private lastAcceptedRoot: string | undefined;
    private disposed = false;

    constructor(
        readonly type: string,
        private readonly config: unknown,
        rootPath: string,
    ) {
        validateRootPath(rootPath);
        this.rootPath = rootPath;
        this.sourceUrl = boardTreeSourceIdentity({ type, config, rootPath });
        this.lastAcceptedRoot = this.currentAcceptedProvider()?.boardRoot;
        this.unsubscribeAvailability = this.subscribeForOwnerChanges();
    }

    get displayName(): string {
        return this.currentAcceptedProvider()
            ? providerDeclarationFor(this.type)?.boardName ?? this.type
            : this.type;
    }

    get writable(): boolean {
        const accepted = this.currentAcceptedProvider();
        if (!accepted) return false;
        const capabilities = moduleService.providerTreeCapabilities(accepted.boardRoot, this.type);
        return capabilities?.mkdir === true || capabilities?.rename === true || capabilities?.delete === true;
    }

    get mkdir(): ITreeProvider["mkdir"] {
        return this.hasCapability("mkdir") ? (path) => this.runWrite("treeMkdir", path) : undefined;
    }

    get rename(): ITreeProvider["rename"] {
        return this.hasCapability("rename")
            ? (oldPath, newPath) => this.runWrite("treeRename", oldPath, newPath)
            : undefined;
    }

    get deleteItem(): ITreeProvider["deleteItem"] {
        return this.hasCapability("delete") ? (href) => this.deleteByHref(href) : undefined;
    }

    async list(path: string): Promise<ILink[]> {
        const accepted = await this.requireAcceptedProvider();
        const result = await this.request(accepted, "treeList", path);
        if (!result.ok || result.operation !== "treeList") {
            throw invalidProviderResult("treeList");
        }
        const active = this.currentAcceptedProvider();
        if (!active || !BoardRoot.tryFrom(active.boardRoot)?.equals(accepted.boardRoot)) {
            throw new ProviderUnavailableError(this.type, providerDeclarationFor(this.type));
        }
        const items = result.items;
        for (const item of items) {
            const scheme = schemeOf(item.href);
            const owner = BoardRoot.tryFrom(boardSchemeOwner(scheme ?? ""));
            const declared = active.schemes.some((value) =>
                value.trim().toLowerCase().replace(/:$/, "") === scheme);
            if (!scheme || !declared || !owner?.equals(active.boardRoot)) {
                throw invalidProviderResult("treeList");
            }
        }

        const folders: ILink[] = [];
        const files: ILink[] = [];
        for (const item of items) {
            const mapped: ILink = {
                title: item.name,
                href: item.href,
                category: path,
                tags: item.isDirectory ? [] : this.extensionTags(item.name),
                isDirectory: item.isDirectory,
                size: item.size,
                mtime: item.mtime,
            };
            (item.isDirectory ? folders : files).push(mapped);
        }
        folders.sort((a, b) => a.title.localeCompare(b.title));
        files.sort((a, b) => a.title.localeCompare(b.title));

        for (const item of items) {
            this.hrefToPath.set(hrefKey(item.href), item.path);
            this.pathToHref.set(item.path, item.href);
        }
        const pathKey = path;
        if (result.truncated) {
            if (!this.truncatedPaths.has(pathKey)) {
                ui.notify(t("api.proxyTreeTruncated", { path, count: items.length }), "warning");
                this.truncatedPaths.add(pathKey);
            }
        } else {
            this.truncatedPaths.delete(pathKey);
        }
        return [...folders, ...files];
    }

    async stat(path: string): Promise<ITreeStat> {
        const accepted = await this.requireAcceptedProvider();
        const result = await this.request(accepted, "treeStat", path);
        if (!result.ok || result.operation !== "treeStat") {
            throw invalidProviderResult("treeStat");
        }
        return result.stat;
    }

    resolveLink(path: string): string {
        const href = this.pathToHref.get(path);
        if (!href) throw new Error(`No listed board tree item is known at path "${path}".`);
        return href;
    }

    getNavigationUrl(item: ILink): string {
        if (!item.isDirectory) return item.href;
        const path = item.href === this.rootPath
            ? this.rootPath
            : this.joinItemPath(item.category, item.title);
        if (path !== this.rootPath && this.pathToHref.get(path) !== item.href) {
            throw new Error(`No listed board tree item is known at path "${path}".`);
        }
        return encodeCategoryLink({ type: this.type, url: this.sourceUrl, category: path });
    }

    async getNavigationUrlByHref(href: string): Promise<string> {
        const path = href === this.rootPath ? this.rootPath : this.hrefToPath.get(hrefKey(href));
        if (!path) throw new Error(`No listed board tree item is known for href "${href}".`);
        const stat = await this.stat(path);
        return stat.isDirectory
            ? encodeCategoryLink({ type: this.type, url: this.sourceUrl, category: path })
            : this.pathToHref.get(path) ?? href;
    }

    getCategorySegments(category: string): ICategorySegment[] {
        if (category === this.rootPath) return [];
        const prefix = /[\\/]$/.test(this.rootPath) ? this.rootPath : `${this.rootPath}/`;
        if (!category.startsWith(prefix)) return [];
        const relative = category.slice(prefix.length);
        const parts = relative.split(/[\\/]/).filter(Boolean);
        return parts.map((label, index) => ({
            label,
            category: parts.slice(0, index + 1).reduce(
                (current, segment) => this.joinItemPath(current, segment),
                this.rootPath,
            ),
        }));
    }

    describeRoot(): Pick<ILink, "icon" | "boardIconRoot"> {
        const accepted = this.currentAcceptedProvider();
        return accepted ? { icon: "board", boardIconRoot: accepted.boardRoot } : {};
    }

    private extensionTags(name: string): string[] {
        const extension = fpExtname(name).toLowerCase();
        return extension ? [extension] : [];
    }

    private joinItemPath(category: string, name: string): string {
        if (!category) return name;
        return /[\\/]$/.test(category) ? category + name : `${category}/${name}`;
    }

    private currentAcceptedProvider(): AcceptedProvider | undefined {
        const declaration = providerDeclarationFor(this.type);
        if (!declaration?.trusted || !declaration.tree || !declaration.boardRoot) return undefined;
        const acceptedOwner = acceptedBoardProviderOwner(this.type);
        const acceptedRoot = BoardRoot.tryFrom(acceptedOwner);
        if (!acceptedRoot || !acceptedRoot.equals(declaration.boardRoot)) return undefined;
        return { boardRoot: declaration.boardRoot, schemes: declaration.schemes };
    }

    private async requireAcceptedProvider(): Promise<AcceptedProvider> {
        await whenProviderDeclarationsReady();
        const declaration = providerDeclarationFor(this.type);
        if (!declaration || !declaration.trusted || !declaration.boardRoot) {
            throw new MissingProviderError(this.type, declaration);
        }
        if (declaration.tree !== true) throw new ProviderUnavailableError(this.type, declaration);
        const accepted = this.currentAcceptedProvider();
        if (!accepted) throw new ProviderUnavailableError(this.type, declaration);
        this.lastAcceptedRoot = accepted.boardRoot;
        return accepted;
    }

    private async request(
        accepted: AcceptedProvider,
        operation: TreeProviderOperation,
        path: string,
        newPath?: string,
    ): Promise<Extract<ProviderResult, { operation: TreeProviderOperation }> | Extract<ProviderResult, { ok: false }>> {
        const current = this.currentAcceptedProvider();
        if (!current || !BoardRoot.tryFrom(current.boardRoot)?.equals(accepted.boardRoot)) {
            throw new ProviderUnavailableError(this.type, providerDeclarationFor(this.type));
        }
        const controller = operation === "treeList" || operation === "treeStat"
            ? new AbortController()
            : undefined;
        if (controller) this.requests.add(controller);
        const message: TreeProviderRequest = {
            kind: "provider",
            operation,
            type: this.type,
            config: this.config as Record<string, unknown>,
            path,
            newPath,
        };
        try {
            const result: unknown = await moduleService.requestTree(accepted.boardRoot, message, controller?.signal);
            if (controller?.signal.aborted) throw new Error("Board tree request was cancelled.");
            if (!isRecord(result) || result.kind !== "provider-result" || typeof result.ok !== "boolean") {
                throw invalidProviderResult(operation);
            }
            if (result.ok === false) {
                const error = providerResultError(result as ProviderResult);
                if (error) throw error;
                throw invalidProviderResult(operation);
            }
            if (result.operation !== operation) throw invalidProviderResult(operation);
            return result as Extract<ProviderResult, { operation: TreeProviderOperation }>;
        } catch (error: unknown) {
            if (error instanceof ProviderOperationError) throw error;
            if (isRecord(error) && error.code === "provider-invalid-result") {
                throw invalidProviderResult(operation);
            }
            throw mapProviderRequestError(this.type, error);
        } finally {
            if (controller) this.requests.delete(controller);
        }
    }

    private hasCapability(capability: "mkdir" | "rename" | "delete"): boolean {
        const accepted = this.currentAcceptedProvider();
        return accepted !== undefined
            && moduleService.providerTreeCapabilities(accepted.boardRoot, this.type)?.[capability] === true;
    }

    private async runWrite(
        operation: "treeMkdir" | "treeRename",
        path: string,
        newPath?: string,
    ): Promise<void> {
        const capability = operation === "treeMkdir" ? "mkdir" : "rename";
        const accepted = await this.requireAcceptedProvider();
        if (moduleService.providerTreeCapabilities(accepted.boardRoot, this.type)?.[capability] !== true) {
            throw new ProviderUnavailableError(this.type, providerDeclarationFor(this.type));
        }
        await this.request(accepted, operation, path, newPath);
    }

    private async deleteByHref(href: string): Promise<void> {
        const path = this.hrefToPath.get(hrefKey(href));
        if (!path) throw new Error(`Cannot delete unknown board tree href "${href}".`);
        const accepted = await this.requireAcceptedProvider();
        if (moduleService.providerTreeCapabilities(accepted.boardRoot, this.type)?.delete !== true) {
            throw new ProviderUnavailableError(this.type, providerDeclarationFor(this.type));
        }
        await this.request(accepted, "treeDelete", path);
    }

    private subscribeForOwnerChanges(): () => void {
        // Board refresh signals availability before synchronously rebuilding ownership.
        const listener = () => queueMicrotask(() => {
            if (this.disposed) return;
            const currentRoot = this.currentAcceptedProvider()?.boardRoot;
            if (currentRoot !== this.lastAcceptedRoot) {
                for (const request of this.requests) request.abort();
                this.lastAcceptedRoot = currentRoot;
            }
        });
        return subscribeProviderAvailability(listener);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const request of this.requests) request.abort();
        this.requests.clear();
        this.hrefToPath.clear();
        this.pathToHref.clear();
        this.truncatedPaths.clear();
        this.unsubscribeAvailability();
    }
}
