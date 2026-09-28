import type { ILinkData } from "../../shared/link-data";
import { OwnershipRegistry } from "../../shared/ownership-registry";
import type { IContentPipe, IPipeDescriptor } from "../api/types/io.pipe";
import {
    createPipeFromDescriptor,
    type RegistrationOptions,
    type RegistrationResult,
} from "./registry";

export type SchemePhase = "open" | "source-path";

export interface SchemeHookContext {
    readonly phase: SchemePhase;
    readonly delegate: () => Promise<boolean>;
    readonly handoff: () => Promise<void>;
    readonly createPipe: (descriptor: IPipeDescriptor) => IContentPipe;
}

export type SchemeParseHook =
    (data: ILinkData, context: SchemeHookContext) => void | Promise<void>;
export type SchemeResolveHook =
    (data: ILinkData, context: SchemeHookContext) => void | Promise<void>;

export interface SchemeHooks {
    parse: SchemeParseHook;
    resolve: SchemeResolveHook;
}

interface SchemeRegistration {
    readonly hooks: SchemeHooks;
    readonly origin: RegistrationOptions["origin"];
    readonly owner?: string;
}

const schemeOwnership = new OwnershipRegistry<SchemeRegistration>();
const HARD_RESERVED_SCHEMES = new Set([
    "http",
    "https",
    "file",
    "data",
    "blob",
    "mneme",
]);

function normalizeScheme(scheme: string): string {
    return scheme.trim().toLowerCase().replace(/:$/, "");
}

export function schemeOf(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1].toLowerCase();
}

/** Lowercase only a multi-character scheme prefix, preserving the rest byte-for-byte. */
export function canonicalizeScheme(value: string): string {
    const match = /^([a-z][a-z\d+.-]*):/i.exec(value);
    if (!match || match[1].length < 2) return value;
    return `${match[1].toLowerCase()}${value.slice(match[0].length - 1)}`;
}

function createHookContext(
    phase: SchemePhase,
    data: ILinkData,
    delegate: () => Promise<boolean>,
): SchemeHookContext {
    return {
        phase,
        delegate,
        handoff: async () => {
            if (phase === "source-path") {
                await delegate();
                return;
            }
            data.handled = false;
            await delegate();
            data.handled = true;
        },
        createPipe: createPipeFromDescriptor,
    };
}

function duplicateResult(kind: string, name: string, existing: SchemeRegistration): RegistrationResult {
    const reason = existing.owner
        ? `${kind} "${name}" is already owned by board "${existing.owner}".`
        : `${kind} "${name}" is already registered by ${existing.origin}.`;
    return { accepted: false, reason, owner: existing.owner, existingOrigin: existing.origin };
}

function isHardReservedScheme(scheme: string): boolean {
    return HARD_RESERVED_SCHEMES.has(scheme) || scheme.startsWith("persephone-");
}

export function registerScheme(
    scheme: string,
    hooks: SchemeHooks,
    options: RegistrationOptions,
): RegistrationResult {
    const normalizedScheme = normalizeScheme(scheme);
    if (options.origin === "board" && isHardReservedScheme(normalizedScheme)) {
        const reason = `Scheme "${normalizedScheme}" is reserved for the platform.`;
        return { accepted: false, reason };
    }
    const registration: SchemeRegistration = { hooks, origin: options.origin, owner: options.owner };
    const existing = schemeOwnership.get(normalizedScheme);
    if (existing) {
        if (existing.origin === "script" && options.origin === "script") {
            schemeOwnership.replace(normalizedScheme, registration, options);
            return { accepted: true, replaced: existing.origin };
        }
        return duplicateResult("scheme", normalizedScheme, existing.value);
    }
    schemeOwnership.claim(normalizedScheme, registration, options);
    return { accepted: true };
}

/** Remove every board-owned scheme so a full trusted-board refresh can rebuild ownership. */
export function unregisterBoardSchemes(): void {
    schemeOwnership.clearOrigin("board");
}

export function isSchemeRegistered(scheme: string): boolean {
    return schemeOwnership.has(normalizeScheme(scheme));
}

export function listRegisteredSchemes(): string[] {
    return schemeOwnership.keys();
}

export async function dispatchRegisteredSchemeParse(
    data: ILinkData,
    delegate: () => Promise<boolean>,
): Promise<boolean> {
    const registration = schemeOwnership.get(schemeOf(data.href) ?? "")?.value;
    if (!registration) return false;
    await registration.hooks.parse(data, createHookContext("open", data, delegate));
    return true;
}

export async function dispatchRegisteredSchemeResolve(
    data: ILinkData,
    delegate: () => Promise<boolean>,
): Promise<boolean> {
    const registration = schemeOwnership.get(schemeOf(data.url) ?? "")?.value;
    if (!registration) return false;
    await registration.hooks.resolve(data, createHookContext("open", data, delegate));
    return true;
}

/** Resolve a registered source path without entering the page-opening event pipeline. */
export async function resolveRegisteredSourcePath(path: string): Promise<IContentPipe | undefined> {
    const registration = schemeOwnership.get(schemeOf(path) ?? "")?.value;
    if (!registration) return undefined;
    const hooks = registration.hooks;

    const canonicalPath = canonicalizeScheme(path);
    const data: ILinkData = { href: canonicalPath, handled: false };
    let resolved = false;
    const resolveContext = createHookContext("source-path", data, async () => false);
    const parseContext = createHookContext("source-path", data, async () => {
        resolved = true;
        await hooks.resolve(data, resolveContext);
        return true;
    });

    await hooks.parse(data, parseContext);
    if (!resolved) return undefined;
    if (data.pipe) return data.pipe;
    if (data.pipeDescriptor) return createPipeFromDescriptor(data.pipeDescriptor);
    return undefined;
}
