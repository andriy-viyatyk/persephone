import { errMessage } from "../../shared/utils";
import type {
    CapabilityHandlerFilter,
    CapabilityId,
    CapabilityInfo,
    CapabilityInvokeOptions,
    CapabilityPageResult,
    ContentRepresentation,
    DiagramEditResult,
    ICapabilities,
    ImageEditPayload,
} from "./types/capabilities";
import { editorRegistry, type EditorCapabilityDeclaration } from "../editors/base/editorRegistry";
import type { EditorView } from "../../shared/types";
import type { BoardCapabilityDeclaration } from "../editors/board/board-manifest";
import type {
    CapabilityOrigin,
    CapabilityRegistration,
} from "../../ipc/capability-bus-channels";
import { CapabilityError, capabilityBus } from "./capability-bus";

type CapabilityResult = CapabilityPageResult | DiagramEditResult;
type CapabilityHandler = (payload: unknown) => Promise<CapabilityResult>;

interface IndexedCapability {
    registration: CapabilityRegistration;
    order: number;
}

export interface CapabilityRegistrationResult {
    readonly accepted: boolean;
    readonly reason?: string;
    readonly owner?: string;
}

export interface CapabilityRegistrationOptions {
    readonly boardRoot?: string;
    readonly handlerKey: string;
    readonly origin: CapabilityOrigin;
}

const builtinHandlers = new Map<string, CapabilityHandler>();
const candidates = new Map<string, IndexedCapability[]>();
let nextRegistrationOrder = 0;
let platformCandidatesSeeded = false;

function capabilityKey(id: CapabilityId, representation?: ContentRepresentation): string {
    return `${id}:${representation ?? ""}`;
}

function reportDuplicate(id: CapabilityId, representation: ContentRepresentation | undefined): void {
    const name = representation ? `${id}/${representation}` : id;
    void import("./ui")
        .then(({ ui }) => ui.notify(
            `Duplicate capability registration: "${name}". The first registration remains active.`,
            "error",
        ))
        .catch((error: unknown) => {
            console.error(`Failed to report duplicate capability registration: ${errMessage(error)}`);
        });
}

function asRecord(payload: unknown, capability: CapabilityId): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError(`${capability} expects an object payload.`);
    }
    return payload as Record<string, unknown>;
}

function requiredString(
    payload: Record<string, unknown>,
    key: string,
    capability: CapabilityId,
): string {
    const value = payload[key];
    if (typeof value !== "string") {
        throw new TypeError(`${capability} expects a string ${key}.`);
    }
    return value;
}

function createPageHandler(
    editorId: string,
    capability: CapabilityId,
    representation?: ContentRepresentation,
): CapabilityHandler {
    return async (payload: unknown): Promise<CapabilityPageResult> => {
        const values = asRecord(payload, capability);
        const content = requiredString(values, "content", capability);
        const language = requiredString(values, "language", capability);
        const title = requiredString(values, "title", capability);
        if (capability === "content.view" && values.representation !== representation) {
            throw new TypeError(
                `content.view expects representation "${representation}" for this handler.`,
            );
        }

        const { pagesModel } = await import("./pages");
        const page = pagesModel.addEditorPage(editorId as EditorView, language, title, content);
        return { pageId: page.id };
    };
}

function createHandler(
    editorId: string,
    declaration: EditorCapabilityDeclaration,
): CapabilityHandler {
    return createPageHandler(editorId, declaration.id, declaration.representation);
}

function addCandidate(registration: CapabilityRegistration): void {
    const entries = candidates.get(registration.id) ?? [];
    entries.push({ registration, order: nextRegistrationOrder++ });
    candidates.set(registration.id, entries);
}

function seedPlatformCandidates(): void {
    if (platformCandidatesSeeded) return;
    const definitions = editorRegistry.getAll();
    if (definitions.length === 0) return;

    for (const definition of definitions) {
        for (const declaration of definition.capabilities ?? []) {
            const key = capabilityKey(declaration.id, declaration.representation);
            if (builtinHandlers.has(key)) {
                reportDuplicate(declaration.id, declaration.representation);
                continue;
            }
            builtinHandlers.set(key, createHandler(definition.id, declaration));
            addCandidate({
                id: declaration.id,
                version: 1,
                priority: 50,
                origin: "platform",
                handlerKey: definition.id,
            });
        }
    }
    platformCandidatesSeeded = true;
}

function validateCapabilityId(id: string): string | undefined {
    if (!id) return "Capability id must not be empty.";
    if (/\s/.test(id)) return `Capability id "${id}" must not contain whitespace.`;
    if (id.includes("@")) return `Capability id "${id}" must not contain "@".`;
    return undefined;
}

function registrationFromDeclaration(
    declaration: BoardCapabilityDeclaration,
    options: CapabilityRegistrationOptions,
): { registration?: CapabilityRegistration; reason?: string } {
    const id = declaration.id.trim();
    const idReason = validateCapabilityId(id);
    if (idReason) return { reason: idReason };
    if (declaration.version !== undefined && !Number.isInteger(declaration.version)) {
        return { reason: `Capability "${id}" version must be an integer.` };
    }

    return {
        registration: {
            id,
            version: declaration.version ?? 1,
            priority: declaration.priority ?? 50,
            ...(declaration.accepts !== undefined ? { accepts: [...declaration.accepts] } : {}),
            ...(Object.prototype.hasOwnProperty.call(declaration, "payloadSchema")
                ? { payloadSchema: declaration.payloadSchema }
                : {}),
            ...(declaration.title !== undefined ? { title: declaration.title } : {}),
            ...(declaration.headless === true ? { headless: true } : {}),
            handlerKey: options.handlerKey,
            origin: options.origin,
            ...(options.boardRoot !== undefined ? { boardRoot: options.boardRoot } : {}),
        },
    };
}

function matchesFilter(candidate: IndexedCapability, filter?: CapabilityHandlerFilter): boolean {
    if (!filter || filter.mime === undefined) return true;
    const accepts = candidate.registration.accepts;
    return accepts === undefined || accepts.includes(filter.mime);
}

function compareCandidates(left: IndexedCapability, right: IndexedCapability): number {
    const priorityDifference = right.registration.priority - left.registration.priority;
    if (priorityDifference !== 0) return priorityDifference;
    if (left.registration.origin !== right.registration.origin) {
        return left.registration.origin === "platform" ? -1 : 1;
    }
    return left.order - right.order;
}

function orderedCandidates(id: string, filter?: CapabilityHandlerFilter): IndexedCapability[] {
    return (candidates.get(id) ?? [])
        .filter((candidate) => matchesFilter(candidate, filter))
        .sort(compareCandidates);
}

function copyInfo(candidate: IndexedCapability): CapabilityInfo {
    const registration = candidate.registration;
    return {
        id: registration.id,
        version: registration.version,
        priority: registration.priority,
        handlerKey: registration.handlerKey,
        origin: registration.origin,
        ...(registration.boardRoot !== undefined ? { boardRoot: registration.boardRoot } : {}),
        ...(registration.accepts !== undefined ? { accepts: [...registration.accepts] } : {}),
        ...(Object.prototype.hasOwnProperty.call(registration, "payloadSchema")
            ? { payloadSchema: registration.payloadSchema }
            : {}),
        ...(registration.title !== undefined ? { title: registration.title } : {}),
        ...(registration.headless === true ? { headless: true } : {}),
    };
}

function parseCapabilityId(id: string): { bareId?: string; version?: number; reason?: string } {
    const at = id.lastIndexOf("@");
    if (at < 0) return { bareId: id };
    if (at === 0 || id.indexOf("@") !== at) {
        return { reason: `No capability handler matches "${id}".` };
    }
    const bareId = id.slice(0, at);
    const version = Number(id.slice(at + 1));
    if (!bareId || !Number.isInteger(version)) {
        return { reason: `No capability handler matches "${id}".` };
    }
    return { bareId, version };
}

function noHandlerError(id: string, version?: number): CapabilityError {
    const suffix = version === undefined ? "" : ` at version ${version}`;
    return new CapabilityError("no-handler", `No capability handler matches "${id}"${suffix}.`);
}

function unwrapBoardCapabilityResult(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const envelope = value as { pageId?: unknown; result?: unknown };
    if (typeof envelope.pageId !== "string") return value;
    const result = envelope.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
        if ((result as { status?: unknown }).status === "conversion-failed") return result;
        return { ...(result as Record<string, unknown>), pageId: envelope.pageId };
    }
    return { pageId: envelope.pageId };
}

/** Register one board declaration, returning a readable refusal for Board Info diagnostics. */
export function registerCapability(
    declaration: BoardCapabilityDeclaration,
    options: CapabilityRegistrationOptions,
): CapabilityRegistrationResult {
    seedPlatformCandidates();
    const result = registrationFromDeclaration(declaration, options);
    if (!result.registration) return { accepted: false, reason: result.reason };
    addCandidate(result.registration);
    return { accepted: true };
}

/** Remove every board-origin capability before a trusted-board rebuild.
 *  `activeBoardRoots` is retained for the registry bookkeeping shape only; the board-origin set,
 *  not the current trusted roots snapshot, is the authoritative revocation key. */
export function unregisterBoardCapabilities(_activeBoardRoots?: readonly string[]): void {
    seedPlatformCandidates();
    for (const [id, entries] of candidates) {
        const retained = entries.filter((entry) => entry.registration.origin !== "board");
        if (retained.length > 0) candidates.set(id, retained);
        else candidates.delete(id);
    }
}

/** Resolve the best indexed candidate using D4 ordering and optional version/filter constraints. */
export function resolveCapability(
    id: string,
    version?: number,
    filter?: CapabilityHandlerFilter,
): CapabilityRegistration | undefined {
    seedPlatformCandidates();
    if (version !== undefined && !Number.isInteger(version)) return undefined;
    const candidate = orderedCandidates(id, filter)
        .find((entry) => version === undefined || entry.registration.version === version);
    return candidate?.registration;
}

class Capabilities implements ICapabilities {
    invoke(id: "text.open", payload: { content: string; language: string; title: string }): Promise<CapabilityPageResult>;
    invoke(id: "content.view", payload: { representation: ContentRepresentation; content: string; language: string; title: string }): Promise<CapabilityPageResult>;
    invoke(id: "image.edit", payload: ImageEditPayload): Promise<CapabilityPageResult>;
    invoke(id: "diagram.edit", payload: { source: string; title: string }): Promise<DiagramEditResult>;
    invoke(id: string, payload: unknown, opts?: CapabilityInvokeOptions): Promise<unknown>;
    async invoke(id: CapabilityId, payload: unknown, opts?: CapabilityInvokeOptions): Promise<unknown> {
        seedPlatformCandidates();
        const parsed = parseCapabilityId(id);
        if (!parsed.bareId) throw noHandlerError(id);
        if (opts?.version !== undefined && parsed.version !== undefined && opts.version !== parsed.version) {
            throw noHandlerError(id, parsed.version);
        }
        const version = parsed.version ?? opts?.version;

        try {
            const values = parsed.bareId === "content.view"
                ? asRecord(payload, parsed.bareId)
                : undefined;
            const representation = values?.representation;
            if (parsed.bareId === "content.view" && typeof representation !== "string") {
                throw new TypeError("content.view expects a string representation.");
            }

            const registration = resolveCapability(parsed.bareId, version, opts?.filter);
            if (!registration) throw noHandlerError(id, version);
            if (registration.headless) throw noHandlerError(id, version);

            if (registration.origin === "platform") {
                const handler = builtinHandlers.get(
                    capabilityKey(parsed.bareId, representation as ContentRepresentation | undefined),
                );
                if (!handler) throw noHandlerError(id, version);
                try {
                    return await handler(payload);
                } catch (error) {
                    throw new CapabilityError(
                        "rejected",
                        errMessage(error, `Capability "${id}" was rejected.`),
                        undefined,
                        error,
                    );
                }
            }

            const result = await capabilityBus.invoke(
                registration,
                payload,
                parsed.version === undefined ? opts : { ...opts, version: parsed.version },
            );
            return unwrapBoardCapabilityResult(result);
        } catch (error) {
            if (error instanceof CapabilityError) throw error;
            throw new CapabilityError(
                "rejected",
                errMessage(error, `Capability "${id}" was rejected.`),
                undefined,
                error,
            );
        }
    }

    list(): readonly CapabilityInfo[] {
        seedPlatformCandidates();
        return Object.freeze(
            [...candidates.values()].flat().sort((left, right) => left.order - right.order).map(copyInfo),
        );
    }

    handlers(id: string, filter?: CapabilityHandlerFilter): readonly CapabilityInfo[] {
        seedPlatformCandidates();
        return Object.freeze(orderedCandidates(id, filter).map(copyInfo));
    }
}

export const capabilities = new Capabilities();
