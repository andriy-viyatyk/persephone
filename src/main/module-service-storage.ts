import type {
    ServiceMainMessage,
    ServiceParentMessage,
} from "../ipc/module-service-channels";
import {
    MAX_OUTSTANDING_REQUESTS_PER_SERVICE,
    SERVICE_REQUEST_DEADLINE_MS,
} from "../ipc/module-service-channels";
import {
    createBoardStorageOperationContract,
    validateBoardStorageKey,
    validateBoardStorageValue,
    type JsonValue,
} from "./board-storage";
import { errMessage } from "../shared/utils";

interface StorageContext {
    getBoardRoot: () => string;
    getUnavailableCode: () => string;
    getOutstandingRequestCount: () => number;
    isAvailable: () => boolean;
    postMessage: (message: ServiceParentMessage) => void;
}

interface PendingStorageRequest {
    timer: ReturnType<typeof setTimeout>;
}

/** Main-side adapter for storage calls originating in a module service. */
export class ModuleServiceStorageAdapter {
    private readonly pending = new Map<string, PendingStorageRequest>();

    constructor(private readonly context: StorageContext) {}

    handle(message: ServiceMainMessage): void {
        if (message.kind !== "storage-request" || typeof message.requestId !== "string") return;
        if (this.pending.has(message.requestId)
            || this.pending.size + this.context.getOutstandingRequestCount() >= MAX_OUTSTANDING_REQUESTS_PER_SERVICE) {
            this.respondError(message.requestId, "service-busy");
            return;
        }
        if (!this.context.isAvailable()) {
            this.respondError(message.requestId, this.context.getUnavailableCode());
            return;
        }

        const timer = setTimeout(() => {
            this.pending.delete(message.requestId);
            this.respondError(message.requestId, "service-timeout");
        }, SERVICE_REQUEST_DEADLINE_MS);
        this.pending.set(message.requestId, { timer });

        void this.run(message).then(
            (result) => this.respondResult(message.requestId, result),
            (error: unknown) => this.respondError(message.requestId, errMessage(error, "service-error")),
        );
    }

    settle(code: string): void {
        for (const [requestId, request] of this.pending) {
            clearTimeout(request.timer);
            this.pending.delete(requestId);
            this.respondError(requestId, code);
        }
    }

    private async run(
        message: Extract<ServiceMainMessage, { kind: "storage-request" }>,
    ): Promise<JsonValue | string[] | boolean | undefined> {
        const contract = createBoardStorageOperationContract(this.context.getBoardRoot());
        const args = message.args;
        switch (message.operation) {
            case "get":
                if (args.length !== 1) throw new TypeError("storage.get expects one key.");
                return contract.get(validateBoardStorageKey(args[0]));
            case "set":
                if (args.length !== 2) throw new TypeError("storage.set expects a key and value.");
                await contract.set(
                    validateBoardStorageKey(args[0]),
                    validateBoardStorageValue(args[1]),
                );
                return undefined;
            case "delete":
                if (args.length !== 1) throw new TypeError("storage.delete expects one key.");
                return contract.delete(validateBoardStorageKey(args[0]));
            case "keys":
                if (args.length !== 0) throw new TypeError("storage.keys expects no arguments.");
                return contract.keys();
            default:
                return this.unreachableOperation(message.operation);
        }
    }

    private unreachableOperation(operation: never): never {
        throw new TypeError(`Unknown service storage operation: ${String(operation)}`);
    }

    private respondResult(requestId: string, result: JsonValue | string[] | boolean | undefined): void {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        this.send({ kind: "storage-response", requestId, result });
    }

    private respondError(requestId: string, error: string): void {
        const pending = this.pending.get(requestId);
        if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(requestId);
        }
        this.send({ kind: "storage-response", requestId, error });
    }

    private send(message: ServiceParentMessage): void {
        try {
            this.context.postMessage(message);
        } catch {
            // The utility process may have exited between the operation and its response.
        }
    }
}
