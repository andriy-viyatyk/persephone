import { PLATFORM_AUDIO_CAPABILITY_ID, PLATFORM_CAPABILITY_IDS } from "./capability-constants";
export type { CapabilityErrorCode } from "./capability-constants";
import { normalizeBoardServicePath, type BoardServiceInterfaceDeclaration } from "./board/board-service-declarations";
import { normalizeStringList } from "./board/normalize-string-list";
import { CAPABILITY_DEFAULT_TIMEOUT_MS, CAPABILITY_MAX_TIMEOUT_MS, MAX_CAPABILITY_ARGUMENTS, MAX_CAPABILITY_DECLARATIONS, MAX_CAPABILITY_DESCRIPTION_LENGTH, MAX_CAPABILITY_ID_LENGTH, MAX_CAPABILITY_METHOD_NAME_LENGTH, MAX_CAPABILITY_METHODS, MAX_CAPABILITY_TITLE_LENGTH } from "./capability-limits";

export interface CapabilityArgument { name: string; type: string; optional?: boolean; description?: string }
export type CapabilityJson = null | boolean | number | string | CapabilityJson[] | { [key: string]: CapabilityJson };
export interface CapabilityCallerIdentity { id: string; name: string; kind: "board-page" | "board-service" | "platform" | "agent" }
export interface CapabilityMethod { kind: "call" | "channel" | "open"; summary: string; args: CapabilityArgument[]; returns?: string; timeoutMs: number; agent: boolean; payloadSchema?: unknown }
export interface BoardCapabilityDeclaration {
    id: string; representation?: string; version?: number; priority?: number; accepts?: string[];
    payloadSchema?: unknown; title?: string; headless?: boolean; alwaysOpensNewPage?: boolean;
    methods?: Record<string, CapabilityMethod>;
}

const reservedIds: readonly string[] = Object.values(PLATFORM_CAPABILITY_IDS);
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
const legacyOpenTypes: Readonly<Record<string, readonly string[]>> = {
    "speech.transcribe": ["describe", "transcribe"],
    "speech.synthesize": ["describe", "speak"],
    "speech.wake": ["describe", "enroll", "list", "delete", "listen"],
    "text.translate": ["describe", "detect", "translate", "download"],
    "agent.session": ["describe", "list-sessions", "open"],
};

/** Project legacy declarations into named methods while retaining their original data. */
export function mergeCapabilityDeclarations(declarations: readonly BoardCapabilityDeclaration[], interfaces: readonly BoardServiceInterfaceDeclaration[]): BoardCapabilityDeclaration[] {
    const merged: Array<BoardCapabilityDeclaration & { methods: Record<string, CapabilityMethod> }> = [];
    const legacyMetadata = new Set<BoardCapabilityDeclaration>();
    for (const source of declarations) {
        let target = merged.find((item) => item.id === source.id && (item.version ?? 1) === (source.version ?? 1)
            && item.representation === source.representation);
        if (!target) {
            target = { ...source, methods: Object.create(null) as Record<string, CapabilityMethod> };
            merged.push(target);
        }
        if (!source.methods && !legacyMetadata.has(target)) {
            Object.assign(target, source, { methods: target.methods });
            legacyMetadata.add(target);
        }
        if (source.methods) Object.assign(target.methods, source.methods);
        else if (!Object.prototype.hasOwnProperty.call(target.methods, "open")) {
            target.methods.open = {
                kind: "open", summary: "Open", args: [{ name: "payload", type: "unknown" }],
                timeoutMs: CAPABILITY_DEFAULT_TIMEOUT_MS, agent: true,
                ...(Object.prototype.hasOwnProperty.call(source, "payloadSchema") ? { payloadSchema: source.payloadSchema } : {}),
            };
        }
    }
    for (const service of interfaces) {
        const types = new Set([...(service.version === 1 ? legacyOpenTypes[service.id] ?? [] : []), ...(service.openTypes ?? [])]);
        let declaration = merged.find((item) => item.id === service.id && (item.version ?? 1) === service.version);
        if (!declaration) {
            declaration = { id: service.id, version: service.version, ...(service.title ? { title: service.title } : {}), methods: Object.create(null) as Record<string, CapabilityMethod> };
            merged.push(declaration);
        }
        for (const type of types) {
            if (!Object.prototype.hasOwnProperty.call(declaration.methods, type)) declaration.methods[type] = { kind: "channel", summary: type, args: [], timeoutMs: CAPABILITY_DEFAULT_TIMEOUT_MS, agent: true };
        }
    }
    return merged;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const boundedString = (value: unknown, max: number, nonempty = false): value is string => typeof value === "string" && value.length <= max && (!nonempty || !!value.trim());

/** The original renderer registration rules also apply to main's legacy projection. */
export function validateLegacyCapabilityDeclaration(declaration: BoardCapabilityDeclaration): string | undefined {
    const id = declaration.id.trim();
    if (!id) return "Capability id must not be empty.";
    if (id === PLATFORM_AUDIO_CAPABILITY_ID) return 'Capability id "audio" is reserved for Persephone.';
    if (/\s/.test(id)) return `Capability id "${id}" must not contain whitespace.`;
    if (id.includes("@")) return `Capability id "${id}" must not contain "@".`;
    if (declaration.version !== undefined && !Number.isInteger(declaration.version)) return `Capability "${id}" version must be an integer.`;
    if (id === "content.view" && (typeof declaration.representation !== "string" || !declaration.representation.trim())) {
        return 'Capability "content.view" requires a non-empty string representation.';
    }
    if (declaration.alwaysOpensNewPage !== undefined && typeof declaration.alwaysOpensNewPage !== "boolean") {
        return `Capability "${id}" alwaysOpensNewPage must be a boolean.`;
    }
    return undefined;
}

export function normalizeCapabilityDeclarations(raw: unknown, reportIssue?: (id: string, reason: string) => void, context?: { service?: unknown; permissions?: unknown }): BoardCapabilityDeclaration[] {
    if (!Array.isArray(raw)) return [];
    const result: BoardCapabilityDeclaration[] = [];
    let newCount = 0;
    for (const entry of raw) {
        if (!record(entry)) continue;
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        const fail = (reason: string) => reportIssue?.(id || "<empty id>", reason);
        if (!("methods" in entry)) {
            const accepts = normalizeStringList(entry.accepts, { map: (value) => value.trim() });
            if ("alwaysOpensNewPage" in entry && typeof entry.alwaysOpensNewPage !== "boolean") { fail(`Capability "${id || "<empty id>"}" alwaysOpensNewPage must be a boolean.`); continue; }
            const declaration: BoardCapabilityDeclaration = { id, ...(typeof entry.representation === "string" ? { representation: entry.representation.trim() } : {}), ...(typeof entry.version === "number" ? { version: entry.version } : {}), ...(typeof entry.priority === "number" ? { priority: entry.priority } : {}), ...(accepts.length ? { accepts } : {}), ...("payloadSchema" in entry ? { payloadSchema: entry.payloadSchema } : {}), ...(typeof entry.title === "string" ? { title: entry.title.trim() } : {}), ...(typeof entry.headless === "boolean" ? { headless: entry.headless } : {}), ...(typeof entry.alwaysOpensNewPage === "boolean" ? { alwaysOpensNewPage: entry.alwaysOpensNewPage } : {}) };
            const reason = validateLegacyCapabilityDeclaration(declaration);
            if (reason) { fail(reason); continue; }
            result.push(declaration);
            continue;
        }
        if (++newCount > MAX_CAPABILITY_DECLARATIONS) { fail("Too many capability declarations."); continue; }
        if (!id || id.length > MAX_CAPABILITY_ID_LENGTH || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id) || id.startsWith("system.") || reservedIds.some((reserved) => id.startsWith(`${reserved}.`))) { fail("Invalid or reserved capability id."); continue; }
        if (entry.version !== undefined && (!Number.isSafeInteger(entry.version) || (entry.version as number) <= 0)) { fail("Version must be a positive safe integer."); continue; }
        if (entry.title !== undefined && (typeof entry.title !== "string" || entry.title.trim().length > MAX_CAPABILITY_TITLE_LENGTH)) { fail("Invalid title."); continue; }
        if (entry.priority !== undefined && (typeof entry.priority !== "number" || !Number.isFinite(entry.priority))) { fail("Invalid priority."); continue; }
        if (entry.representation !== undefined && !boundedString(entry.representation, Infinity, true) || id === "content.view" && !boundedString(entry.representation, Infinity, true)) { fail("A nonempty representation is required."); continue; }
        if (entry.accepts !== undefined && (!Array.isArray(entry.accepts) || !entry.accepts.every((value) => boundedString(value, Infinity, true)))) { fail("Invalid accepts list."); continue; }
        if (entry.alwaysOpensNewPage !== undefined && typeof entry.alwaysOpensNewPage !== "boolean") { fail("Invalid alwaysOpensNewPage."); continue; }
        if (!record(entry.methods) || !Object.keys(entry.methods).length || Object.keys(entry.methods).length > MAX_CAPABILITY_METHODS) { fail("Methods must be a nonempty object with at most 32 entries."); continue; }
        const methods: Record<string, CapabilityMethod> = Object.create(null) as Record<string, CapabilityMethod>;
        let error = "";
        for (const [name, value] of Object.entries(entry.methods)) {
            if (!identifier.test(name) || name.length > MAX_CAPABILITY_METHOD_NAME_LENGTH || name === "providers" || name === "$help" || name === "provider" || name === "then" || !record(value)) { error = "Invalid method name or definition."; break; }
            if (value.kind !== "call" && value.kind !== "channel" && value.kind !== "open" || !boundedString(value.summary, MAX_CAPABILITY_DESCRIPTION_LENGTH, true)) { error = `Invalid method ${name}.`; break; }
            if (value.kind !== "open" && (!context || !normalizeBoardServicePath(context.service) || !record(context.permissions) || context.permissions.service !== true)) { error = `Method ${name} requires a service and service permission.`; break; }
            if (value.args !== undefined && (!Array.isArray(value.args) || value.args.length > MAX_CAPABILITY_ARGUMENTS)) { error = `Invalid arguments for ${name}.`; break; }
            const args: CapabilityArgument[] = [];
            let optional = false;
            for (const arg of (value.args as unknown[] | undefined) ?? []) {
                if (!record(arg) || typeof arg.name !== "string" || !identifier.test(arg.name) || args.some((item) => item.name === arg.name) || !boundedString(arg.type, MAX_CAPABILITY_DESCRIPTION_LENGTH, true) || arg.optional !== undefined && typeof arg.optional !== "boolean" || arg.description !== undefined && !boundedString(arg.description, MAX_CAPABILITY_DESCRIPTION_LENGTH) || optional && arg.optional !== true) { error = `Invalid argument for ${name}.`; break; }
                optional ||= arg.optional === true;
                args.push({ name: arg.name, type: arg.type, ...(arg.optional !== undefined ? { optional: arg.optional as boolean } : {}), ...(typeof arg.description === "string" ? { description: arg.description } : {}) });
            }
            if (error) break;
            if (value.kind === "open" && args.length !== 1 || value.returns !== undefined && !boundedString(value.returns, MAX_CAPABILITY_DESCRIPTION_LENGTH) || value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs) || (value.timeoutMs as number) <= 0 || (value.timeoutMs as number) > CAPABILITY_MAX_TIMEOUT_MS) || value.agent !== undefined && typeof value.agent !== "boolean") { error = `Invalid method ${name}.`; break; }
            methods[name] = { kind: value.kind, summary: value.summary, args, ...(typeof value.returns === "string" ? { returns: value.returns } : {}), timeoutMs: typeof value.timeoutMs === "number" ? value.timeoutMs : CAPABILITY_DEFAULT_TIMEOUT_MS, agent: value.agent !== false };
        }
        if (error) { fail(error); continue; }
        result.push({ id, version: typeof entry.version === "number" ? entry.version : 1, priority: typeof entry.priority === "number" ? entry.priority : 50, ...(typeof entry.title === "string" && entry.title.trim() ? { title: entry.title.trim() } : {}), ...(typeof entry.representation === "string" ? { representation: entry.representation.trim() } : {}), ...(Array.isArray(entry.accepts) ? { accepts: entry.accepts as string[] } : {}), alwaysOpensNewPage: entry.alwaysOpensNewPage === true, methods });
    }
    return result;
}
