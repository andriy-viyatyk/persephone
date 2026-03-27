import type { IProvider, IProviderDescriptor } from "./io.provider";
import type { ITransformer, ITransformerDescriptor } from "./io.transformer";
import type { IContentPipe, IPipeDescriptor } from "./io.pipe";
import type { IBaseEvent } from "./events";
import type { ILinkMetadata } from "./io.events";

/**
 * Provider constructor for local binary files.
 * @example
 * const provider = new io.FileProvider("C:\\data\\file.txt");
 */
export interface IFileProviderConstructor {
    new(filePath: string): IProvider;
}

/**
 * Provider constructor for HTTP/HTTPS URLs.
 * @example
 * const provider = new io.HttpProvider("https://api.com/data.json", {
 *     method: "POST",
 *     headers: { "Authorization": "Bearer token" },
 *     body: JSON.stringify({ key: "value" }),
 * });
 */
export interface IHttpProviderConstructor {
    new(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): IProvider;
}

/**
 * Transformer constructor for ZIP archive entry extraction.
 * @example
 * const transformer = new io.ZipTransformer("data/report.csv");
 */
export interface IZipTransformerConstructor {
    new(entryPath: string): ITransformer;
}

/**
 * Transformer constructor for AES-GCM decryption/encryption.
 * @example
 * const transformer = new io.DecryptTransformer(password);
 */
export interface IDecryptTransformerConstructor {
    new(password: string): ITransformer;
}

/**
 * Raw link event constructor — Layer 1 input.
 * @example
 * await app.events.openRawLink.sendAsync(new io.RawLinkEvent("C:\\file.txt"));
 * await app.events.openRawLink.sendAsync(new io.RawLinkEvent("https://api.com/data.json"));
 */
export interface IRawLinkEventConstructor {
    new(raw: string): IBaseEvent & { readonly raw: string };
}

/**
 * Open link event constructor — Layer 2 input.
 * @example
 * await app.events.openLink.sendAsync(new io.OpenLinkEvent("https://api.com/data", undefined, {
 *     headers: { "Authorization": "Bearer token" },
 * }));
 */
export interface IOpenLinkEventConstructor {
    new(url: string, target?: string, metadata?: Record<string, unknown>): IBaseEvent & {
        readonly url: string;
        target?: string;
        metadata?: Record<string, unknown>;
    };
}

/**
 * The `io` global namespace — content pipe building and link events.
 *
 * Available in scripts alongside `app`, `page`, and `ui`.
 *
 * @example
 * // Read a file from inside a ZIP archive
 * const pipe = io.createPipe(
 *     new io.FileProvider("C:\\docs.zip"),
 *     new io.ZipTransformer("readme.md"),
 * );
 * const text = await pipe.readText();
 *
 * @example
 * // Open a URL through the link pipeline
 * await app.events.openRawLink.sendAsync(
 *     new io.RawLinkEvent("https://api.com/data.json")
 * );
 */
export interface IIoNamespace {
    /** Provider for local binary files. */
    readonly FileProvider: IFileProviderConstructor;
    /** Provider for HTTP/HTTPS URLs (read-only). */
    readonly HttpProvider: IHttpProviderConstructor;
    /** Transformer for ZIP archive entry extraction/replacement. */
    readonly ZipTransformer: IZipTransformerConstructor;
    /** Transformer for AES-GCM decryption/encryption (non-persistent). */
    readonly DecryptTransformer: IDecryptTransformerConstructor;
    /** Raw link event constructor for Layer 1 (openRawLink). */
    readonly RawLinkEvent: IRawLinkEventConstructor;
    /** Open link event constructor for Layer 2 (openLink). */
    readonly OpenLinkEvent: IOpenLinkEventConstructor;
    /** Create a content pipe from a provider and optional transformers. */
    createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe;
}
