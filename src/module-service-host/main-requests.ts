import { codedError } from "../shared/coded-error";
import { PendingRequests } from "../shared/pending-requests";
import { errMessage } from "../shared/utils";
import { CAPABILITY_DEFAULT_TIMEOUT_MS, MAX_OUTSTANDING_REQUESTS_PER_SERVICE } from "../shared/capability-limits";
import type { ServiceMainMessage, ServiceParentMessage } from "../ipc/module-service-channels";
import { isRecord } from "./validation";

type MainRequestMessage = Extract<ServiceMainMessage, {
    kind: "storage-request" | "mcp-endpoint-request" | "board-settings-get" | "board-settings-subscribe" | "board-settings-unsubscribe"
}>;

interface MainResponseMessage {
    requestId: string;
    result?: unknown;
    error?: unknown;
}

interface MainRequestFamilyOptions {
    idPrefix: "storage" | "mcp" | "board-settings";
    timeoutMessage: string;
    exitedMessage: string;
    failureFallback: string;
    isFailure(message: MainResponseMessage): boolean;
    configReady: Promise<unknown>;
    post(message: ServiceMainMessage): void;
    nextSequence(): number;
}

export class MainRequestFamily {
    private readonly pending = new PendingRequests<unknown, undefined, string>({
        nextId: (): string => `${this.options.idPrefix}-${process.pid}-${Date.now()}-${this.options.nextSequence()}`,
    });

    public constructor(private readonly options: MainRequestFamilyOptions) {}

    public async request(createMessage: (requestId: string) => MainRequestMessage): Promise<unknown> {
        await this.options.configReady;
        if (this.pending.size >= MAX_OUTSTANDING_REQUESTS_PER_SERVICE) {
            throw codedError("service-busy", "Service is busy.");
        }
        const { id: requestId, promise } = this.pending.create(CAPABILITY_DEFAULT_TIMEOUT_MS, undefined, {
            timeoutError: (): Error & { code: "service-timeout" } => codedError("service-timeout", this.options.timeoutMessage),
        });
        try {
            this.options.post(createMessage(requestId));
        } catch {
            this.pending.fail(requestId, codedError("service-exited", this.options.exitedMessage));
        }
        return promise;
    }

    public settleResponse(message: MainResponseMessage, failureFallback: string = this.options.failureFallback, hasError: (response: MainResponseMessage) => boolean = this.options.isFailure, successValue: (response: MainResponseMessage) => unknown = (response): unknown => response.result): void {
        if (hasError(message)) {
            const code = typeof message.error === "string" ? "service-error"
                : isRecord(message.error) && typeof message.error.code === "string" ? message.error.code : "service-error";
            this.pending.fail(message.requestId, codedError(code, errMessage(message.error, failureFallback)));
        } else {
            this.pending.settle(message.requestId, successValue(message));
        }
    }

    public failAll(error: Error): void {
        this.pending.failAll(error);
    }

    public clear(): void {
        this.pending.clear();
    }
}

type MainResponseKind = Extract<ServiceParentMessage, {
    kind: "storage-response" | "mcp-endpoint-response" | "board-settings-response" | "board-settings-subscribe-response" | "board-settings-unsubscribe-response"
}>["kind"];

interface MainResponsePolicy {
    family: "storage" | "mcp" | "settings";
    failureFallback: string;
    hasError(response: MainResponseMessage): boolean;
    successValue?(response: MainResponseMessage): unknown;
}

const RESPONSE_POLICIES: Readonly<Record<MainResponseKind, MainResponsePolicy>> = Object.freeze({
    "storage-response": { family: "storage", failureFallback: "Service storage request failed.", hasError: (response): boolean => "error" in response },
    "mcp-endpoint-response": { family: "mcp", failureFallback: "MCP endpoint request failed.", hasError: (response): boolean => Boolean(response.error) },
    "board-settings-response": { family: "settings", failureFallback: "Board settings request failed.", hasError: (response): boolean => Boolean(response.error) },
    "board-settings-subscribe-response": { family: "settings", failureFallback: "Board settings subscription failed.", hasError: (response): boolean => Boolean(response.error), successValue: (): undefined => undefined },
    "board-settings-unsubscribe-response": { family: "settings", failureFallback: "Board settings subscription failed.", hasError: (response): boolean => Boolean(response.error), successValue: (): undefined => undefined },
});

export interface MainRequestClients {
    storage: MainRequestFamily;
    mcp: MainRequestFamily;
    settings: MainRequestFamily;
    handleResponse(message: Record<string, unknown>): boolean;
}

export function createMainRequestClients(dependencies: {
    configReady: Promise<unknown>;
    post(message: ServiceMainMessage): void;
    nextSequence(): number;
}): MainRequestClients {
    const storage = new MainRequestFamily({ ...dependencies, idPrefix: "storage", timeoutMessage: "service-timeout", exitedMessage: "service-exited", failureFallback: "Service storage request failed.", isFailure: (response): boolean => "error" in response });
    const mcp = new MainRequestFamily({ ...dependencies, idPrefix: "mcp", timeoutMessage: "Service request timed out.", exitedMessage: "The service has exited.", failureFallback: "MCP endpoint request failed.", isFailure: (response): boolean => Boolean(response.error) });
    const settings = new MainRequestFamily({ ...dependencies, idPrefix: "board-settings", timeoutMessage: "Service request timed out.", exitedMessage: "The service has exited.", failureFallback: "Board settings request failed.", isFailure: (response): boolean => Boolean(response.error) });
    return {
        storage,
        mcp,
        settings,
        handleResponse(message): boolean {
            if (typeof message.kind !== "string" || !Object.hasOwn(RESPONSE_POLICIES, message.kind) || typeof message.requestId !== "string") return false;
            // The own-key check narrows the runtime discriminant to this table's keys.
            const kind = message.kind as MainResponseKind;
            const policy = RESPONSE_POLICIES[kind];
            // The wire boundary above validates the discriminant and request id.
            const response = message as unknown as MainResponseMessage;
            const family = policy.family === "storage" ? storage : policy.family === "mcp" ? mcp : settings;
            family.settleResponse(response, policy.failureFallback, policy.hasError, policy.successValue);
            return true;
        },
    };
}
