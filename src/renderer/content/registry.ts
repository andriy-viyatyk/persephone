import { errMessage } from "../../shared/utils";
import { englishMessage, t } from "../../shared/i18n/t";
import { OwnershipRegistry } from "../../shared/ownership-registry";
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
    readonly replaced?: RegistrationOrigin;
    readonly existingOrigin?: RegistrationOrigin;
}

export interface ProviderDeclaration {
    readonly type: string;
    readonly boardRoot?: string;
    readonly boardName?: string;
    readonly trusted: boolean;
}

interface ProviderRegistration {
    readonly factory: ProviderFactory;
    readonly origin: RegistrationOrigin;
    readonly owner?: string;
}

const providerOwnership = new OwnershipRegistry<ProviderRegistration>();
const transformerFactories = new Map<string, TransformerFactory>();
const providerShapeValidationErrors = new Map<string, Error | null>();
const providerDeclarations = new Map<string, ProviderDeclaration>();
const providerAvailabilityListeners = new Set<() => void>();

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
        .then(({ ui }) => ui.notify(t("api.providerRegistrationFailed", { error: message }), "error"))
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

function reportTransformerDuplicate(
    kind: string,
    name: string,
): void {
    const reason = t("api.duplicateProviderRegistration", { kind, name });
    void import("../api/ui")
        .then(({ ui }) => ui.notify(
            reason,
            "error",
        ))
        .catch((error: unknown) => {
            console.error(`Failed to report duplicate ${kind} registration: ${errMessage(error)}`);
        });
}

function duplicateResult(kind: string, name: string, existing: ProviderRegistration): RegistrationResult {
    const reason = existing.owner
        ? englishMessage("api.duplicateProviderOwnedByBoard", { kind, name, owner: existing.owner })
        : englishMessage("api.duplicateProviderRegisteredBy", { kind, name, origin: existing.origin });
    return { accepted: false, reason, owner: existing.owner, existingOrigin: existing.origin };
}

/** Return the single namespace refusal shared by registration and Board Info collection. */
export function boardProviderTypeRefusal(type: string): string | undefined {
    return type.includes("/")
        ? undefined
        : `Provider type "${type}" must contain "/"; un-namespaced provider types are reserved for the platform.`;
}

export function registerProvider(
    type: string,
    factory: ProviderFactory,
    options: RegistrationOptions,
): RegistrationResult {
    if (options.origin === "board") {
        const reason = boardProviderTypeRefusal(type);
        if (reason) return { accepted: false, reason };
    }
    const registration: ProviderRegistration = {
        factory: options.origin === "script" ? wrapScriptProviderFactory(type, factory) : factory,
        origin: options.origin,
        owner: options.owner,
    };
    const existing = providerOwnership.get(type);
    if (existing) {
        if (existing.origin === "script" && options.origin === "script") {
            providerShapeValidationErrors.delete(type);
            providerOwnership.replace(type, registration, options);
            signalProviderAvailability();
            return { accepted: true, replaced: existing.origin };
        }
        return duplicateResult("provider", type, existing.value);
    }
    providerOwnership.claim(type, registration, options);
    signalProviderAvailability();
    return { accepted: true };
}

/** Remove every board-owned provider so a full trusted-board refresh can rebuild ownership. */
export function unregisterBoardProviders(): void {
    providerOwnership.clearOrigin("board");
    signalProviderAvailability();
}

export function registerTransformer(type: string, factory: TransformerFactory): void {
    if (transformerFactories.has(type)) {
        reportTransformerDuplicate("transformer", type);
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

export function providerDeclarationFor(type: string): ProviderDeclaration | undefined {
    return providerDeclarations.get(type);
}

function tryCreateRegisteredProvider(
    descriptor: IProviderDescriptor,
): IProvider | undefined {
    const registration = providerOwnership.get(descriptor.type)?.value;
    if (!registration) return undefined;
    return registration.factory(descriptor.config);
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
    // Iterate a snapshot: a listener may re-subscribe while it runs, and a live Set iteration
    // would visit the new entry in the same pass and loop forever.
    for (const listener of [...providerAvailabilityListeners]) listener();
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
    return () => providerAvailabilityListeners.delete(listener);
}

class MissingProvider implements IProvider {
    readonly type: string;
    readonly displayName: string;
    readonly sourceUrl: string;
    readonly restorable = true;
    private delegate: IProvider | undefined;
    private resolutionAttempt: Promise<IProvider> | undefined;
    private readonly watchers = new Set<{
        callback: (event: string) => void;
        disposeRegistryWatch: () => void;
        disposeDelegateWatch?: () => void;
    }>();
    private disposed = false;

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

    get writable(): boolean {
        return this.delegate?.writable ?? false;
    }

    get createReadStream(): IProvider["createReadStream"] {
        const delegate = this.delegate;
        const createReadStream = delegate?.createReadStream;
        if (!createReadStream) return undefined;
        return (range, options) => createReadStream.call(delegate, range, options);
    }

    readBinary(options?: { signal?: AbortSignal }): Promise<Buffer> {
        return this.resolveDelegate().then((delegate) => delegate.readBinary(options));
    }

    async stat(options?: { signal?: AbortSignal }) {
        const delegate = await this.resolveDelegate();
        if (delegate.stat) return delegate.stat(options);
        const buffer = await delegate.readBinary(options);
        return { exists: true, size: buffer.length };
    }

    async writeBinary(data: Buffer): Promise<void> {
        const delegate = await this.resolveDelegate();
        if (!delegate.writeBinary) {
            throw new ProviderUnavailableError(this.descriptor.type, providerDeclarationFor(this.descriptor.type));
        }
        await delegate.writeBinary(data);
    }

    private resolveDelegate(): Promise<IProvider> {
        if (this.delegate) return Promise.resolve(this.delegate);
        if (!this.resolutionAttempt) {
            const attempt = this.resolveOnce();
            this.resolutionAttempt = attempt;
            void attempt.catch(() => {
                if (this.resolutionAttempt === attempt) this.resolutionAttempt = undefined;
            });
        }
        return this.resolutionAttempt;
    }

    private async resolveOnce(): Promise<IProvider> {
        await whenProviderDeclarationsReady();
        const declaration = providerDeclarationFor(this.descriptor.type);
        if (!declaration || !declaration.trusted || !declaration.boardRoot) {
            throw new MissingProviderError(this.descriptor.type, declaration);
        }
        const delegate = tryCreateRegisteredProvider(this.descriptor);
        if (!delegate) throw new ProviderUnavailableError(this.descriptor.type, declaration);
        this.delegate = delegate;
        if (this.disposed) {
            delegate.dispose?.();
            return delegate;
        }
        for (const watcher of this.watchers) {
            watcher.disposeDelegateWatch = delegate.watch?.(watcher.callback);
        }
        return delegate;
    }

    watch(callback: (event: string) => void): () => void {
        if (this.disposed) return () => undefined;
        const disposeRegistryWatch = subscribeProviderAvailability(() => callback("available"));
        const disposeDelegateWatch = this.delegate?.watch?.(callback);
        const watcher = { callback, disposeRegistryWatch, disposeDelegateWatch };
        this.watchers.add(watcher);
        return () => {
            if (!this.watchers.delete(watcher)) return;
            watcher.disposeRegistryWatch();
            watcher.disposeDelegateWatch?.();
        };
    }

    dispose(): void {
        this.disposed = true;
        for (const watcher of this.watchers) {
            watcher.disposeRegistryWatch();
            watcher.disposeDelegateWatch?.();
        }
        this.watchers.clear();
        this.delegate?.dispose?.();
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
        sessionHandle: config.sessionHandle as string | undefined,
        boardNetworkPolicy: config.boardNetworkPolicy as import("../api/node-fetch").BoardNetworkPolicy | undefined,
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
