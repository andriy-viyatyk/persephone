import { moduleServiceStatus } from "../../api/module-service-status";
import { subscribeModuleServiceTreeAvailability } from "../../api/module-service-tree-availability";
import { BoardRoot } from "../../../shared/board/board-root";
import {
    acceptedBoardTreeProviderForRoot,
    providerDeclarationFor,
    subscribeProviderAvailability,
} from "../../content/registry";
import type { TreeProviderDescriptor } from "../../content/tree-providers/tree-provider-factory";

/** Coalesces provider-registry refresh notifications until synchronous claims settle. */
export class ExplorerProviderRecovery {
    private queued = false;
    private disposed = false;
    private readonly unsubscribeRegistry: () => void;
    private unsubscribeStatus: (() => void) | undefined;
    private unsubscribeTreeAvailability: (() => void) | undefined;
    private bindingGeneration = 0;
    private descriptor: TreeProviderDescriptor | undefined;
    private serviceWasNotRunning = false;

    constructor(private readonly refresh: () => void) {
        this.unsubscribeRegistry = subscribeProviderAvailability(this.onRegistryChange);
    }

    setDescriptor(descriptor: TreeProviderDescriptor | undefined): void {
        if (this.disposed) return;
        this.descriptor = descriptor;
        this.bindCurrentBoard();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.bindingGeneration++;
        this.unsubscribeRegistry();
        this.unsubscribeStatus?.();
        this.unsubscribeTreeAvailability?.();
        this.unsubscribeStatus = undefined;
        this.unsubscribeTreeAvailability = undefined;
    }

    private readonly onRegistryChange = (): void => {
        if (this.disposed) return;
        this.bindCurrentBoard();
        this.scheduleRefresh();
    };

    private bindCurrentBoard(): void {
        this.bindingGeneration++;
        this.unsubscribeStatus?.();
        this.unsubscribeTreeAvailability?.();
        this.unsubscribeStatus = undefined;
        this.unsubscribeTreeAvailability = undefined;
        this.serviceWasNotRunning = false;

        const descriptor = this.descriptor;
        if (!descriptor) return;
        const declaration = providerDeclarationFor(descriptor.type);
        const boardRoot = declaration?.boardRoot;
        const root = BoardRoot.tryFrom(boardRoot);
        if (!root || !acceptedBoardTreeProviderForRoot(descriptor.type, root.path)) return;

        const initialStatus = moduleServiceStatus.getStatus(root.path);
        this.serviceWasNotRunning = initialStatus !== undefined && initialStatus.state !== "running";
        const generation = this.bindingGeneration;
        this.unsubscribeStatus = moduleServiceStatus.subscribe(root.path, (status) => {
            if (this.disposed || generation !== this.bindingGeneration) return;
            if (status.state !== "running") {
                this.serviceWasNotRunning = true;
                return;
            }
            if (!this.serviceWasNotRunning) return;
            this.serviceWasNotRunning = false;
            if (this.isCurrentAcceptedBoard(descriptor.type, root)) this.scheduleRefresh();
        });
        this.unsubscribeTreeAvailability = subscribeModuleServiceTreeAvailability(root.path, descriptor.type, () => {
            if (!this.disposed && generation === this.bindingGeneration
                && this.isCurrentAcceptedBoard(descriptor.type, root)) this.scheduleRefresh();
        });
    }

    private isCurrentAcceptedBoard(type: string, root: BoardRoot): boolean {
        const current = providerDeclarationFor(type)?.boardRoot;
        return BoardRoot.tryFrom(current)?.equals(root) === true
            && acceptedBoardTreeProviderForRoot(type, root.path) !== undefined;
    }

    private readonly scheduleRefresh = (): void => {
        if (this.queued || this.disposed) return;
        this.queued = true;
        queueMicrotask(() => {
            queueMicrotask(() => {
                this.queued = false;
                if (!this.disposed) this.refresh();
            });
        });
    };
}
