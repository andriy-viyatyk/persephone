import { api } from "../../../../ipc/renderer/api";
import { BoardGrant } from "../../../../shared/board/board-grant";
import type { BoardNetworkPolicy } from "../../../../shared/board/board-grant";
import { boardRegistry } from "../../../api/boards/board-registry";
import type { IContentPipe } from "../../../api/types/io.pipe";
import { pipeFromLink } from "../../../content/rebuild-pipe";
import { createPipeFromDescriptor } from "../../../content/registry";
import { isBoardClaimedScheme, schemeOf } from "../../../content/scheme-registry";
import { contentTypeForPipe } from "../../../content/board-pipe-utils";
import { registerPipeResource, unregisterPipeResource } from "../../../content/pipe-resource-server";
import type { BoardSourceInbox } from "./BoardSourceInbox";

export interface ContentResourceInfo {
    readonly resourceId: string;
    readonly size: number;
    readonly contentType: string;
    readonly filePath?: string;
}

export interface BoardContentResourcePolicy {
    readonly networkPolicy?: BoardNetworkPolicy;
    readonly host: string;
    readonly isCurrent: () => boolean;
}

export interface BoardContentResourcesOptions {
    readonly boardRoot: () => string | undefined;
    readonly inbox: BoardSourceInbox;
}

interface ContentResource {
    readonly pipe: IContentPipe;
    readonly tabId: string;
    readonly generation: number;
}

export class BoardContentResources {
    private readonly resources = new Map<string, ContentResource>();

    constructor(private readonly options: BoardContentResourcesOptions) { }

    async open(
        link: string,
        tabId: string,
        generation: number,
        signal: AbortSignal | undefined,
        policy: BoardContentResourcePolicy,
    ): Promise<ContentResourceInfo | undefined> {
        if (signal?.aborted) throw new Error("The content resource request was cancelled.");
        const sourceSessionHandle = this.options.inbox.sessionHandleFor(link);
        const boardRoot = this.options.boardRoot();
        if (!boardRoot) throw new Error("The board root is unavailable.");
        const scheme = schemeOf(link);
        if (scheme && isBoardClaimedScheme(scheme) && !boardRegistry.grant(boardRoot)?.allows("service")) {
            throw BoardGrant.deny("service");
        }
        let pipe = await pipeFromLink(link, {
            sessionHandle: sourceSessionHandle,
            boardNetworkPolicy: policy.networkPolicy,
        });
        let resourceId: string | undefined;
        let info: ContentResourceInfo;
        try {
            const descriptor = pipe.toDescriptor();
            let filePath: string | undefined;
            if (descriptor.provider.type === "http" && policy.networkPolicy?.network === false) {
                throw BoardGrant.deny("network");
            }
            if (descriptor.provider.type === "file") {
                const configuredPath = descriptor.provider.config.path;
                if (typeof configuredPath !== "string") {
                    throw new Error("The file provider did not expose an authorizable path.");
                }
                const canonicalPath = await api.authorizeBoardFilePath(boardRoot, configuredPath, "read");
                descriptor.provider.config.path = canonicalPath;
                for (const transformer of descriptor.transformers) {
                    if (transformer.type === "archive" && transformer.config.archivePath === configuredPath) {
                        transformer.config.archivePath = canonicalPath;
                    }
                }
                pipe.dispose();
                pipe = createPipeFromDescriptor(descriptor);
                filePath = canonicalPath;
            } else if (!["http", "data", "cache", "mneme", "guide"].includes(descriptor.provider.type)) {
                if (!boardRegistry.grant(boardRoot)?.allows("service")) {
                    throw BoardGrant.deny("service");
                }
                throw new Error(
                    "This registered content provider does not expose a path that can be authorized for board access.",
                );
            }
            const stat = await pipe.stat({ signal });
            if (signal?.aborted) throw new Error("The content resource request was cancelled.");
            if (!stat.exists || stat.size === undefined || !Number.isFinite(stat.size) || stat.size < 0) {
                throw new Error("The content provider did not report a usable resource size.");
            }
            resourceId = `resource-${crypto.randomUUID()}`;
            while (this.resources.has(resourceId)) resourceId = `resource-${crypto.randomUUID()}`;
            this.resources.set(resourceId, { pipe, tabId, generation });
            registerPipeResource(resourceId, pipe, { kind: "board", boardRoot, hostedDocument: false });
            if (sourceSessionHandle) this.options.inbox.consumeSessionHandle(link, sourceSessionHandle);
            info = {
                resourceId,
                size: stat.size,
                contentType: contentTypeForPipe(pipe),
                ...(filePath ? { filePath } : {}),
            };
        } catch (error: unknown) {
            if (resourceId && this.resources.has(resourceId)) this.release(resourceId);
            else pipe.dispose();
            throw error;
        }

        if (signal?.aborted) {
            this.release(info.resourceId);
            throw new Error("The content resource request was cancelled.");
        }
        if (!policy.isCurrent()) {
            this.release(info.resourceId);
            return undefined;
        }
        try {
            await api.registerBoardPipeResource(info.resourceId, policy.host, boardRoot, info.filePath);
        } catch (error: unknown) {
            this.release(info.resourceId);
            throw error;
        }
        if (!policy.isCurrent()) {
            this.release(info.resourceId);
            return undefined;
        }
        return info;
    }

    release(id: string): void {
        const resource = this.resources.get(id);
        if (!resource) return;
        this.resources.delete(id);
        resource.pipe.dispose();
        void api.unregisterBoardPipeResource(id);
        unregisterPipeResource(id);
    }

    releaseForFrame(tabId: string, generation: number): void {
        const resourceIds = [...this.resources.entries()]
            .filter(([, resource]) => resource.tabId === tabId && resource.generation === generation)
            .map(([resourceId]) => resourceId);
        for (const resourceId of resourceIds) this.release(resourceId);
    }

    dispose(): void {
        const resourceIds = [...this.resources.keys()];
        for (const resourceId of resourceIds) this.release(resourceId);
    }
}
