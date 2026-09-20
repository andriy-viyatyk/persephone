import type { ILinkData } from "../../shared/link-data";
import { errMessage } from "../../shared/utils";
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

const schemeHooks = new Map<string, SchemeRegistration>();
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

function schemeFromValue(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const scheme = /^([a-z][a-z\d+.-]*):/.exec(value)?.[1];
    return scheme ? normalizeScheme(scheme) : undefined;
}

function reportDuplicate(kind: string, name: string, existingOrigin?: RegistrationOptions["origin"]): void {
    const ownerMessage = existingOrigin
        ? ` The existing ${existingOrigin} registration remains active.`
        : " The first registration remains active.";
    void import("../api/ui")
        .then(({ ui }) => ui.notify(
            `Duplicate ${kind} registration: "${name}".${ownerMessage}`,
            "error",
        ))
        .catch((error: unknown) => {
            console.error(`Failed to report duplicate ${kind} registration: ${errMessage(error)}`);
        });
}

function reportReplacement(
    kind: string,
    name: string,
    previousOrigin: RegistrationOptions["origin"],
): void {
    void import("../api/ui")
        .then(({ ui }) => ui.notify(
            `Replaced ${kind} registration: "${name}" (previous origin: ${previousOrigin}).`,
            "info",
        ))
        .catch((error: unknown) => {
            console.error(`Failed to report replaced ${kind} registration: ${errMessage(error)}`);
        });
}

function reportRejected(kind: string, name: string, reason: string): void {
    void import("../api/ui")
        .then(({ ui }) => ui.notify(
            `Rejected ${kind} registration: "${name}". ${reason}`,
            "error",
        ))
        .catch((error: unknown) => {
            console.error(`Failed to report rejected ${kind} registration: ${errMessage(error)}`);
        });
}

function duplicateResult(
    kind: string,
    name: string,
    existing: SchemeRegistration,
): RegistrationResult {
    const reason = existing.owner
        ? `${kind} "${name}" is already owned by board "${existing.owner}".`
        : `${kind} "${name}" is already registered by ${existing.origin}.`;
    reportDuplicate(kind, name, existing.origin);
    return { accepted: false, reason, owner: existing.owner };
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
        reportRejected("scheme", normalizedScheme, reason);
        return { accepted: false, reason };
    }
    const existing = schemeHooks.get(normalizedScheme);
    if (existing) {
        if (existing.origin === "script" && options.origin === "script") {
            schemeHooks.set(normalizedScheme, {
                hooks,
                origin: options.origin,
                owner: options.owner,
            });
            reportReplacement("scheme", normalizedScheme, existing.origin);
            return { accepted: true };
        }
        return duplicateResult("scheme", normalizedScheme, existing);
    }
    schemeHooks.set(normalizedScheme, {
        hooks,
        origin: options.origin,
        owner: options.owner,
    });
    return { accepted: true };
}

/** Remove every board-owned scheme so a full trusted-board refresh can rebuild ownership. */
export function unregisterBoardSchemes(): void {
    for (const [scheme, registration] of schemeHooks) {
        if (registration.origin === "board") schemeHooks.delete(scheme);
    }
}

export function isSchemeRegistered(scheme: string): boolean {
    return schemeHooks.has(normalizeScheme(scheme));
}

export function listRegisteredSchemes(): string[] {
    return Array.from(schemeHooks.keys());
}

export async function dispatchRegisteredSchemeParse(
    data: ILinkData,
    delegate: () => Promise<boolean>,
): Promise<boolean> {
    const registration = schemeHooks.get(schemeFromValue(data.href));
    if (!registration) return false;
    await registration.hooks.parse(data, {
        phase: "open",
        delegate,
        createPipe: createPipeFromDescriptor,
    });
    return true;
}

export async function dispatchRegisteredSchemeResolve(
    data: ILinkData,
    delegate: () => Promise<boolean>,
): Promise<boolean> {
    const registration = schemeHooks.get(schemeFromValue(data.url));
    if (!registration) return false;
    await registration.hooks.resolve(data, {
        phase: "open",
        delegate,
        createPipe: createPipeFromDescriptor,
    });
    return true;
}

/** Resolve a registered source path without entering the page-opening event pipeline. */
export async function resolveRegisteredSourcePath(path: string): Promise<IContentPipe | undefined> {
    const registration = schemeHooks.get(schemeFromValue(path));
    if (!registration) return undefined;
    const hooks = registration.hooks;

    const data: ILinkData = { href: path, handled: false };
    let resolved = false;
    const resolveContext: SchemeHookContext = {
        phase: "source-path",
        delegate: async () => false,
        createPipe: createPipeFromDescriptor,
    };
    const parseContext: SchemeHookContext = {
        phase: "source-path",
        delegate: async () => {
            resolved = true;
            await hooks.resolve(data, resolveContext);
            return true;
        },
        createPipe: createPipeFromDescriptor,
    };

    await hooks.parse(data, parseContext);
    if (!resolved) return undefined;
    if (data.pipe) return data.pipe;
    if (data.pipeDescriptor) return createPipeFromDescriptor(data.pipeDescriptor);
    return undefined;
}
