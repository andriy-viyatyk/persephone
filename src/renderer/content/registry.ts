import type { IProvider, IProviderDescriptor } from "../api/types/io.provider";
import type { ITransformer, ITransformerDescriptor } from "../api/types/io.transformer";
import type { IPipeDescriptor } from "../api/types/io.pipe";
import type { IContentPipe } from "../api/types/io.pipe";
import { ContentPipe } from "./ContentPipe";
import { FileProvider } from "./providers/FileProvider";
import { CacheFileProvider } from "./providers/CacheFileProvider";
import { HttpProvider } from "./providers/HttpProvider";
import { ZipTransformer } from "./transformers/ZipTransformer";
import { DecryptTransformer } from "./transformers/DecryptTransformer";

type ProviderFactory = (config: Record<string, unknown>) => IProvider;
type TransformerFactory = (config: Record<string, unknown>) => ITransformer;

const providerFactories = new Map<string, ProviderFactory>();
const transformerFactories = new Map<string, TransformerFactory>();

export function registerProvider(type: string, factory: ProviderFactory): void {
    providerFactories.set(type, factory);
}

export function registerTransformer(type: string, factory: TransformerFactory): void {
    transformerFactories.set(type, factory);
}

export function createProviderFromDescriptor(descriptor: IProviderDescriptor): IProvider {
    const factory = providerFactories.get(descriptor.type);
    if (!factory) {
        throw new Error(`Unknown provider type: "${descriptor.type}"`);
    }
    return factory(descriptor.config);
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

// ── Built-in registrations ──────────────────────────────────────────

registerProvider("file", (config) => new FileProvider(config.path as string));
registerProvider("cache", (config) => new CacheFileProvider(config.pageId as string));
registerProvider("http", (config) => new HttpProvider(
    config.url as string,
    {
        method: config.method as string | undefined,
        headers: config.headers as Record<string, string> | undefined,
        body: config.body as string | undefined,
    },
));
registerTransformer("zip", (config) => new ZipTransformer(config.entryPath as string));
registerTransformer("decrypt", (config) => new DecryptTransformer(config.password as string));
