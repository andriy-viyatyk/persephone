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

interface ProviderRegistration {
    readonly factory: ProviderFactory;
    readonly origin: RegistrationOrigin;
    readonly owner?: string;
}

const providerFactories = new Map<string, ProviderRegistration>();
const transformerFactories = new Map<string, TransformerFactory>();
const providerShapeValidationErrors = new Map<string, Error | null>();

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

function reportDuplicate(kind: string, name: string, existingOrigin?: RegistrationOrigin): void {
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
    existing: ProviderRegistration,
): RegistrationResult {
    const reason = existing.owner
        ? `${kind} "${name}" is already owned by board "${existing.owner}".`
        : `${kind} "${name}" is already registered by ${existing.origin}.`;
    reportDuplicate(kind, name, existing.origin);
    return { accepted: false, reason, owner: existing.owner };
}

export function registerProvider(
    type: string,
    factory: ProviderFactory,
    options: RegistrationOptions,
): RegistrationResult {
    if (options.origin === "board" && !type.includes("/")) {
        const reason = `Provider type "${type}" must contain "/"; un-namespaced provider types are reserved for the platform.`;
        reportRejected("provider", type, reason);
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
            return { accepted: true };
        }
        return duplicateResult("provider", type, existing);
    }
    providerFactories.set(type, {
        factory: options.origin === "script"
            ? wrapScriptProviderFactory(type, factory)
            : factory,
        origin: options.origin,
        owner: options.owner,
    });
    return { accepted: true };
}

/** Remove every board-owned provider so a full trusted-board refresh can rebuild ownership. */
export function unregisterBoardProviders(): void {
    for (const [type, registration] of providerFactories) {
        if (registration.origin === "board") providerFactories.delete(type);
    }
}

export function registerTransformer(type: string, factory: TransformerFactory): void {
    if (transformerFactories.has(type)) {
        reportDuplicate("transformer", type);
        return;
    }
    transformerFactories.set(type, factory);
}

export function createProviderFromDescriptor(descriptor: IProviderDescriptor): IProvider {
    const registration = providerFactories.get(descriptor.type);
    if (!registration) {
        throw new Error(`Unknown provider type: "${descriptor.type}"`);
    }
    return registration.factory(descriptor.config);
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
