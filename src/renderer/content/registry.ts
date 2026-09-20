import { errMessage } from "../../shared/utils";
import { isCanonicalGuidePath } from "../../shared/guides/guide-links";
import type { IProvider, IProviderDescriptor } from "../api/types/io.provider";
import type { ITransformer, ITransformerDescriptor } from "../api/types/io.transformer";
import type { IContentPipe, IPipeDescriptor } from "../api/types/io.pipe";
import { ContentPipe } from "./ContentPipe";
import { FileProvider } from "./providers/FileProvider";
import { CacheFileProvider } from "./providers/CacheFileProvider";
import { HttpProvider } from "./providers/HttpProvider";
import { DataUrlProvider } from "./providers/DataUrlProvider";
import { MnemeProvider } from "./providers/MnemeProvider";
import { GuideProvider } from "./providers/GuideProvider";
import { ArchiveTransformer } from "./transformers/ArchiveTransformer";
import { BoardProviderUnavailableError, subscribeBoardProviderAvailability } from "./board-provider-factory";
import { moduleService } from "../api/module-service";
import { SERVICE_REQUEST_DEADLINE_MS } from "../../ipc/module-service-channels";
import { fpNormalizeForCompare } from "../core/utils/file-path";

type ProviderFactory = (config: Record<string, unknown>) => IProvider;
type TransformerFactory = (config: Record<string, unknown>) => ITransformer;

export type RegistrationOrigin = "platform" | "script" | (string & {});

export interface RegistrationOptions {
    readonly origin: RegistrationOrigin;
    readonly owner?: string;
}

export interface RegistrationResult {
    readonly accepted: boolean;
    readonly reason?: string;
    readonly owner?: string;
}

export interface ProviderDeclaration {
    readonly type: string;
    readonly boardRoot?: string;
    readonly boardName?: string;
    readonly trusted: boolean;
    readonly source: "trusted" | "installed";
}

interface ProviderRegistration {
    readonly factory: ProviderFactory;
    readonly origin: RegistrationOrigin;
    readonly owner?: string;
}

const providerFactories = new Map<string, ProviderRegistration>();
const transformerFactories = new Map<string, TransformerFactory>();
const providerShapeValidationErrors = new Map<string, Error | null>();
const providerDeclarations = new Map<string, ProviderDeclaration>();
const providerAvailabilityListeners = new Set<() => void>();
const boardRegistrationRefusalToasts = new Map<string, Set<string>>();
const boardProviderAttempts = new Map<string, Promise<void>>();

let providerDeclarationsReady = false;
let resolveProviderDeclarationsReady: (() => void) | undefined;
const providerDeclarationsReadyPromise = new Promise<void>((resolve) => {
    resolveProviderDeclarationsReady = resolve;
});

const REQUIRED_PROVIDER_PROPERTIES = [
    "type",
    "displayName",
    "sourceUrl",
    "restorable",
    "writable",
] as const;

const REQUIRED_PROVIDER_METHODS = ["readBinary", "toDescriptor"] as const;

/**
 * Validate the runtime shape of a provider returned by a registered factory.
 *
 * This deliberately checks only member presence and method callability. The
 * provider pipeline remains responsible for validating values and return types.
 */
export function validateProviderShape(
    provider: unknown,
    providerType: string,
    subjectName = "Provider",
): asserts provider is IProvider {
    const providerObject = provider !== null
        && (typeof provider === "object" || typeof provider === "function")
        ? provider as Record<string, unknown>
        : undefined;
    const missingMembers: string[] = [];

    for (const property of REQUIRED_PROVIDER_PROPERTIES) {
        if (!providerObject || !(property in providerObject)) {
            missingMembers.push(property);
        }
    }

    for (const method of REQUIRED_PROVIDER_METHODS) {
        if (!providerObject || typeof providerObject[method] !== "function") {
            missingMembers.push(`${method}()`);
        }
    }

    if (providerObject?.writable === true && typeof providerObject.writeBinary !== "function") {
        missingMembers.push("writeBinary()");
    }

    if (missingMembers.length > 0) {
        throw new Error(
            `${subjectName} "${providerType}" is missing required member(s): `
            + `${missingMembers.join(", ")}.\n`
            + "See the io guide: scripting/api/io.md",
        );
    }
}

function reportProviderShapeFailure(message: string): void {
    void import("../api/ui")
        .then(({ ui }) => ui.notify(message, "error"))
        .catch((error: unknown) => {
            console.error(`Failed to report provider shape failure: ${errMessage(error)}`);
        });
}

function wrapScriptProviderFactory(type: string, factory: ProviderFactory): ProviderFactory {
    return (config) => {
        const cachedValidationError = providerShapeValidationErrors.get(type);
        if (cachedValidationError) throw cachedValidationError;

        const provider = factory(config);
        if (!providerShapeValidationErrors.has(type)) {
            try {
                validateProviderShape(provider, type);
                providerShapeValidationErrors.set(type, null);
            } catch (error: unknown) {
                const validationError = new Error(errMessage(error));
                providerShapeValidationErrors.set(type, validationError);
                reportProviderShapeFailure(validationError.message);
            }
        }

        const validationError = providerShapeValidationErrors.get(type);
        if (validationError) throw validationError;
        return provider;
    };
}

function refusalToastKey(kind: string, name: string, reason: string): string {
    return `${kind}\u0000${name}\u0000${reason}`;
}

function shouldReportBoardRefusal(
    owner: string | undefined,
    kind: string,
    name: string,
    reason: string,
): boolean {
    if (!owner) return true;
    let refusals = boardRegistrationRefusalToasts.get(fpNormalizeForCompare(owner));
    if (!refusals) {
        refusals = new Set<string>();
        boardRegistrationRefusalToasts.set(fpNormalizeForCompare(owner), refusals);
    }
    const key = refusalToastKey(kind, name, reason);
    if (refusals.has(key)) return false;
    refusals.add(key);
    return true;
}

function reportDuplicate(
    kind: string,
    name: string,
    existingOrigin?: RegistrationOrigin,
    owner?: string,
): void {
    const ownerMessage = existingOrigin
        ? ` The existing ${existingOrigin} registration remains active.`
        : " The first registration remains active.";
    const reason = `Duplicate ${kind} registration: "${name}".${ownerMessage}`;
    if (!shouldReportBoardRefusal(owner, kind, name, reason)) return;
    void import("../api/ui")
        .then(({ ui }) => ui.notify(
            reason,
            "error",
        ))
        .catch((error: unknown) => {
            console.error(`Failed to report duplicate ${kind} registration: ${errMessage(error)}`);
        });
}

function reportReplacement(
    kind: string,
    name: string,
    previousOrigin: RegistrationOrigin,
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

function reportRejected(kind: string, name: string, reason: string, owner?: string): void {
    if (!shouldReportBoardRefusal(owner, kind, name, reason)) return;
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
    existing: ProviderRegistration,
    owner?: string,
): RegistrationResult {
    const reason = existing.owner
        ? `${kind} "${name}" is already owned by board "${existing.owner}".`
        : `${kind} "${name}" is already registered by ${existing.origin}.`;
    reportDuplicate(kind, name, existing.origin, owner);
    return { accepted: false, reason, owner: existing.owner };
}

export function registerProvider(
    type: string,
    factory: ProviderFactory,
    options: RegistrationOptions,
): RegistrationResult {
    if (options.origin === "board" && !type.includes("/")) {
        const reason = `Provider type "${type}" must contain "/"; un-namespaced provider types are reserved for the platform.`;
        reportRejected("provider", type, reason, options.owner);
        return { accepted: false, reason };
    }
    const existing = providerFactories.get(type);
    if (existing) {
        if (existing.origin === "script" && options.origin === "script") {
            providerShapeValidationErrors.delete(type);
            providerFactories.set(type, {
                factory: wrapScriptProviderFactory(type, factory),
                origin: options.origin,
                owner: options.owner,
            });
            reportReplacement("provider", type, existing.origin);
            signalProviderAvailability();
            return { accepted: true };
        }
        return duplicateResult("provider", type, existing, options.owner);
    }
    providerFactories.set(type, {
        factory: options.origin === "script"
            ? wrapScriptProviderFactory(type, factory)
            : factory,
        origin: options.origin,
        owner: options.owner,
    });
    signalProviderAvailability();
    return { accepted: true };
}

/** Remove every board-owned provider so a full trusted-board refresh can rebuild ownership. */
export function unregisterBoardProviders(activeBoardRoots?: readonly string[]): void {
    for (const [type, registration] of providerFactories) {
        if (registration.origin === "board") providerFactories.delete(type);
    }
    clearReleasedBoardRefusalToasts(activeBoardRoots);
    signalProviderAvailability();
}

export function registerTransformer(type: string, factory: TransformerFactory): void {
    if (transformerFactories.has(type)) {
        reportDuplicate("transformer", type);
        return;
    }
    transformerFactories.set(type, factory);
}

function isProviderDescriptor(value: unknown): value is IProviderDescriptor {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && typeof (value as { type?: unknown }).type === "string";
}

function providerDeclarationFor(type: string): ProviderDeclaration | undefined {
    return providerDeclarations.get(type);
}

function tryCreateRegisteredProvider(
    descriptor: IProviderDescriptor,
): IProvider | undefined {
    const registration = providerFactories.get(descriptor.type);
    if (!registration) return undefined;
    try {
        return registration.factory(descriptor.config);
    } catch (error: unknown) {
        if (registration.origin !== "board" || !(error instanceof BoardProviderUnavailableError)) {
            throw error;
        }
        return undefined;
    }
}

function providerErrorDetails(
    type: string,
    declaration: ProviderDeclaration | undefined,
): { boardRoot?: string; boardLabel?: string } {
    return {
        boardRoot: declaration?.boardRoot,
        boardLabel: declaration?.boardName ?? declaration?.boardRoot,
    };
}

function providerErrorMessage(
    type: string,
    declaration: ProviderDeclaration | undefined,
    unavailable: boolean,
): string {
    const details = providerErrorDetails(type, declaration);
    const boardClause = details.boardLabel ? ` from board "${details.boardLabel}"` : "";
    const state = unavailable ? "is unavailable" : "is missing";
    return `Provider "${type}"${boardClause} ${state}. Reinstall or trust the board from Tools & Editors → Search boards.`;
}

export class MissingProviderError extends Error {
    readonly code: string = "provider-missing";

    constructor(
        readonly providerType: string,
        declaration?: ProviderDeclaration,
    ) {
        super(providerErrorMessage(providerType, declaration, false));
        this.name = "MissingProviderError";
        this.boardRoot = declaration?.boardRoot;
        this.boardName = declaration?.boardName;
    }

    readonly boardRoot?: string;
    readonly boardName?: string;
}

export class ProviderUnavailableError extends MissingProviderError {
    override readonly code = "provider-unavailable";

    constructor(
        providerType: string,
        declaration?: ProviderDeclaration,
    ) {
        super(providerType, declaration);
        this.name = "ProviderUnavailableError";
        this.message = providerErrorMessage(providerType, declaration, true);
    }
}

export function isProviderResolutionError(error: unknown): error is MissingProviderError {
    return error instanceof MissingProviderError;
}

function signalProviderAvailability(): void {
    for (const listener of providerAvailabilityListeners) listener();
}

function clearReleasedBoardRefusalToasts(activeBoardRoots?: readonly string[]): void {
    if (!activeBoardRoots) {
        boardRegistrationRefusalToasts.clear();
        return;
    }
    const active = new Set(activeBoardRoots.map(fpNormalizeForCompare));
    for (const root of boardRegistrationRefusalToasts.keys()) {
        if (!active.has(root)) boardRegistrationRefusalToasts.delete(root);
    }
}

export function replaceProviderDeclarations(declarations: readonly ProviderDeclaration[]): void {
    providerDeclarations.clear();
    for (const declaration of declarations) {
        if (!providerDeclarations.has(declaration.type)) {
            providerDeclarations.set(declaration.type, declaration);
        }
    }
    if (!providerDeclarationsReady) {
        providerDeclarationsReady = true;
        resolveProviderDeclarationsReady?.();
    }
    signalProviderAvailability();
}

export function whenProviderDeclarationsReady(): Promise<void> {
    return providerDeclarationsReady ? Promise.resolve() : providerDeclarationsReadyPromise;
}

export function subscribeProviderAvailability(listener: () => void): () => void {
    providerAvailabilityListeners.add(listener);
    const boardProviderDisposer = subscribeBoardProviderAvailability(listener);
    return () => {
        providerAvailabilityListeners.delete(listener);
        boardProviderDisposer();
    };
}

function remainingDeadline(deadline: number): number {
    return Math.max(0, deadline - Date.now());
}

async function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
    const remaining = remainingDeadline(deadline);
    if (remaining <= 0) throw new ProviderUnavailableError("unknown");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("provider-deadline")),
                    remaining,
                );
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function waitForProviderAvailability(
    descriptor: IProviderDescriptor,
    deadline: number,
): Promise<void> {
    while (!tryCreateRegisteredProvider(descriptor)) {
        const remaining = remainingDeadline(deadline);
        if (remaining <= 0) throw new Error("provider-deadline");
        await new Promise<void>((resolve) => {
            const check = () => {
                clearTimeout(timer);
                dispose();
                resolve();
            };
            const dispose = subscribeProviderAvailability(check);
            const timer = setTimeout(check, remaining);
        });
    }
}

async function acquireBoardProvider(
    declaration: ProviderDeclaration,
    descriptor: IProviderDescriptor,
    deadline: number,
): Promise<void> {
    const boardRoot = declaration.boardRoot;
    if (!boardRoot || !declaration.trusted) throw new MissingProviderError(descriptor.type, declaration);
    const key = `${fpNormalizeForCompare(boardRoot)}\u0000${descriptor.type}`;
    const existing = boardProviderAttempts.get(key);
    if (existing) {
        try {
            await withDeadline(existing, deadline);
        } catch {
            throw new ProviderUnavailableError(descriptor.type, declaration);
        }
        return;
    }
    const attempt = (async () => {
        try {
            await withDeadline(moduleService.acquire(boardRoot), deadline);
            await waitForProviderAvailability(descriptor, deadline);
        } catch (error: unknown) {
            throw new ProviderUnavailableError(descriptor.type, declaration);
        }
    })();
    boardProviderAttempts.set(key, attempt);
    try {
        await withDeadline(attempt, deadline);
    } finally {
        if (boardProviderAttempts.get(key) === attempt) boardProviderAttempts.delete(key);
    }
}

class MissingProvider implements IProvider {
    readonly type: string;
    readonly displayName: string;
    readonly sourceUrl: string;
    readonly restorable = true;
    readonly writable = false;
    private state: "missing" | "pending" = "missing";
    private readAttempt: Promise<Buffer> | undefined;

    constructor(private readonly descriptor: IProviderDescriptor) {
        this.type = descriptor.type;
        const declaration = providerDeclarationFor(descriptor.type);
        this.displayName = declaration?.boardName ?? descriptor.type;
        const config = descriptor.config && typeof descriptor.config === "object"
            ? descriptor.config
            : undefined;
        this.sourceUrl = typeof config?.url === "string"
            ? config.url
            : descriptor.type;
    }

    readBinary(): Promise<Buffer> {
        if (!this.readAttempt) {
            const attempt = this.readOnce();
            this.readAttempt = attempt;
            void attempt.catch(() => {
                if (this.readAttempt === attempt) this.readAttempt = undefined;
            });
        }
        return this.readAttempt;
    }

    private async readOnce(): Promise<Buffer> {
        const deadline = Date.now() + SERVICE_REQUEST_DEADLINE_MS;
        try {
            await withDeadline(whenProviderDeclarationsReady(), deadline);
        } catch {
            throw new ProviderUnavailableError(this.descriptor.type, providerDeclarationFor(this.descriptor.type));
        }

        const declaration = providerDeclarationFor(this.descriptor.type);
        const immediate = tryCreateRegisteredProvider(this.descriptor);
        if (immediate) return immediate.readBinary();
        if (!declaration) throw new MissingProviderError(this.descriptor.type);
        if (!declaration.trusted || !declaration.boardRoot) {
            throw new MissingProviderError(this.descriptor.type, declaration);
        }

        this.state = "pending";
        await acquireBoardProvider(declaration, this.descriptor, deadline);
        const delegate = tryCreateRegisteredProvider(this.descriptor);
        if (!delegate) throw new ProviderUnavailableError(this.descriptor.type, declaration);
        try {
            return await delegate.readBinary();
        } catch (error: unknown) {
            if (error instanceof BoardProviderUnavailableError) {
                throw new ProviderUnavailableError(this.descriptor.type, declaration);
            }
            throw error;
        }
    }

    watch(callback: (event: string) => void): () => void {
        const listener = () => {
            this.state = "missing";
            callback("available");
        };
        return subscribeProviderAvailability(listener);
    }

    toDescriptor(): IProviderDescriptor {
        return this.descriptor;
    }
}

export function createProviderFromDescriptor(descriptor: IProviderDescriptor): IProvider {
    if (!isProviderDescriptor(descriptor)) {
        throw new Error("Malformed provider descriptor: expected an object with a string type.");
    }
    const provider = tryCreateRegisteredProvider(descriptor);
    return provider ?? new MissingProvider(descriptor);
}

export function createTransformerFromDescriptor(descriptor: ITransformerDescriptor): ITransformer {
    const factory = transformerFactories.get(descriptor.type);
    if (!factory) {
        throw new Error(`Unknown transformer type: "${descriptor.type}"`);
    }
    return factory(descriptor.config);
}

export function createPipeFromDescriptor(descriptor: IPipeDescriptor): IContentPipe {
    const provider = createProviderFromDescriptor(descriptor.provider);
    const transformers = descriptor.transformers.map(createTransformerFromDescriptor);
    return new ContentPipe(provider, transformers, descriptor.encoding);
}

// ── Built-in provider and transformer registrations ─────────────────────────

registerProvider("file", (config) => new FileProvider(config.path as string), { origin: "platform" });
registerProvider("cache", (config) => new CacheFileProvider(config.pageId as string), { origin: "platform" });
registerProvider("http", (config) => new HttpProvider(
    config.url as string,
    {
        method: config.method as string | undefined,
        headers: config.headers as Record<string, string> | undefined,
        body: config.body as string | undefined,
    },
), { origin: "platform" });
registerProvider("data", (config) => new DataUrlProvider(config.url as string), { origin: "platform" });
registerProvider("mneme", (config) => new MnemeProvider(config.path as string), { origin: "platform" });
registerProvider("guide", (config) => {
    const path = config && typeof config.path === "string" ? config.path : undefined;
    if (!path || !isCanonicalGuidePath(path)) {
        throw new Error("Invalid guide provider descriptor: expected a safe corpus-relative path.");
    }
    return new GuideProvider(path);
}, { origin: "platform" });
registerTransformer("archive", (config) => new ArchiveTransformer(config.archivePath as string, config.entryPath as string));
registerTransformer("decrypt", () => {
    throw new Error("DecryptTransformer cannot be created from descriptor — use clone() instead");
});
