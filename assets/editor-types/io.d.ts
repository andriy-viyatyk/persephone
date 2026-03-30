import type { IProvider, IProviderDescriptor } from "./io.provider";
import type { ITransformer, ITransformerDescriptor } from "./io.transformer";
import type { IContentPipe, IPipeDescriptor } from "./io.pipe";
import type { ITreeProvider } from "./io.tree";
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
 * Tree provider for ZIP archives (and ZIP-based formats like .docx, .xlsx, .epub).
 * Read-only: enumerates archive entries and resolves navigation links.
 * @example
 * const zip = new io.ZipTreeProvider("C:\\docs.zip");
 * const items = await zip.list("");  // root entries
 * const url = zip.getNavigationUrl(items[0]);
 * await app.events.openRawLink.sendAsync(new io.RawLinkEvent(url));
 */
export interface IZipTreeProviderConstructor {
    new(sourceUrl: string): ITreeProvider;
}

/**
 * Raw link event constructor — Layer 1 input.
 * @example
 * await app.events.openRawLink.sendAsync(new io.RawLinkEvent("C:\\file.txt"));
 * await app.events.openRawLink.sendAsync(new io.RawLinkEvent("https://api.com/data.json"));
 */
export interface IRawLinkEventConstructor {
    new(raw: string, target?: string, metadata?: ILinkMetadata): IBaseEvent & {
        readonly raw: string;
        target?: string;
        metadata?: ILinkMetadata;
    };
}

/**
 * Open link event constructor — Layer 2 input.
 * @example
 * await app.events.openLink.sendAsync(new io.OpenLinkEvent("https://api.com/data", undefined, {
 *     headers: { "Authorization": "Bearer token" },
 * }));
 */
export interface IOpenLinkEventConstructor {
    new(url: string, target?: string, metadata?: ILinkMetadata): IBaseEvent & {
        readonly url: string;
        target?: string;
        metadata?: ILinkMetadata;
    };
}

/**
 * Open content event constructor — Layer 3 input.
 * @example
 * const pipe = io.createPipe(new io.FileProvider("C:\\data.zip"), new io.ZipTransformer("report.csv"));
 * await app.events.openContent.sendAsync(new io.OpenContentEvent(pipe, "grid-csv"));
 */
export interface IOpenContentEventConstructor {
    new(pipe: IContentPipe, target: string, metadata?: ILinkMetadata): IBaseEvent & {
        readonly pipe: IContentPipe;
        readonly target: string;
        readonly metadata?: ILinkMetadata;
    };
}

/**
 * The `io` global namespace — content pipe building, tree providers, and link events.
 *
 * Available in scripts alongside `app`, `page`, and `ui`.
 *
 * **Link pipeline (3 layers):**
 * - Use `io.RawLinkEvent` to open any link (file path, URL, cURL command) through the full pipeline (Layer 1 → 2 → 3)
 * - Use `io.OpenLinkEvent` to skip raw parsing and go directly to provider resolution (Layer 2 → 3)
 * - Use `io.OpenContentEvent` to open a pre-assembled pipe directly in an editor (Layer 3)
 * - Use `io.createPipe()` with providers and transformers to build custom content pipes
 *
 * **Tree providers:**
 * - Use `io.ZipTreeProvider` to enumerate and navigate ZIP archive contents
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
 * // Browse and open files from a ZIP archive
 * const zip = new io.ZipTreeProvider("C:\\docs.zip");
 * const items = await zip.list("");
 * const url = zip.getNavigationUrl(items[0]);
 * await app.events.openRawLink.sendAsync(new io.RawLinkEvent(url));
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
    /** Tree provider for ZIP archives — list entries, stat, navigate. */
    readonly ZipTreeProvider: IZipTreeProviderConstructor;
    /** Raw link event constructor for Layer 1 (openRawLink). */
    readonly RawLinkEvent: IRawLinkEventConstructor;
    /** Open link event constructor for Layer 2 (openLink). */
    readonly OpenLinkEvent: IOpenLinkEventConstructor;
    /** Open content event constructor for Layer 3 (openContent). */
    readonly OpenContentEvent: IOpenContentEventConstructor;
    /** Create a content pipe from a provider and optional transformers. */
    createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe;
}
