import type { IProvider } from "./io.provider";
import type { ITransformer } from "./io.transformer";
import type { IContentPipe, IPipeDescriptor } from "./io.pipe";
import type { ILinkData } from "./io.link-data";
import type { ILink } from "./io.tree";

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
 * Transformer constructor for archive entry extraction.
 * Supports ZIP, RAR, 7z, TAR, and other formats via libarchive-wasm (read).
 * Write operations (save back) are supported only for ZIP-based archives.
 * @example
 * const transformer = new io.ArchiveTransformer("C:\\data.zip", "data/report.csv");
 */
export interface IArchiveTransformerConstructor {
    new(archivePath: string, entryPath: string): ITransformer;
}

/**
 * Transformer constructor for AES-GCM decryption/encryption.
 * @example
 * const transformer = new io.DecryptTransformer(password);
 */
export interface IDecryptTransformerConstructor {
    new(password: string): ITransformer;
}

/** Factory used to reconstruct a provider from a persisted descriptor. */
export type IProviderFactory = (config: Record<string, unknown>) => IProvider;

/** Context supplied to a registered scheme hook by the normal link pipeline. */
export interface ISchemeHookContext {
    /** The open pipeline phase, or source-path reconstruction phase. */
    readonly phase: "open" | "source-path";
    /** Continue through the existing EventChannel pipeline. */
    readonly delegate: () => Promise<boolean>;
    /** Reconstruct a content pipe from its persistable descriptor. */
    readonly createPipe: (descriptor: IPipeDescriptor) => IContentPipe;
}

/** Structural parse or resolve callback for a registered URL scheme. */
export type ISchemeHook =
    (data: ILinkData, context: ISchemeHookContext) => void | Promise<void>;

/** The parse and resolve callbacks that implement one URL scheme. */
export interface ISchemeHooks {
    parse: ISchemeHook;
    resolve: ISchemeHook;
}

/**
 * The `io` global namespace — content pipe building and link pipeline helpers.
 *
 * Available in scripts alongside `app`, `page`, and `ui`.
 *
 * **Opening links (ILinkData pipeline):**
 * - Use `io.createLinkData(href)` to open any link through the full pipeline (Layer 1 → 2 → 3)
 * - Use `io.linkToLinkData(link)` to open an ILink with all fields preserved
 * - Use `io.createPipe()` with providers and transformers to build custom content pipes
 *
 * @example
 * // Read a file from inside a ZIP archive
 * const pipe = io.createPipe(
 *     new io.FileProvider("C:\\docs.zip"),
 *     new io.ArchiveTransformer("C:\\docs.zip", "readme.md"),
 * );
 * const text = await pipe.readText();
 *
 * @example
 * // Open a URL through the link pipeline
 * await app.events.openRawLink.sendAsync(
 *     io.createLinkData("https://api.com/data.json")
 * );
 *
 * @example
 * // Open with options
 * await app.events.openRawLink.sendAsync(
 *     io.createLinkData("https://example.com", { target: "browser", browserMode: "incognito" })
 * );
 */
export interface IIoNamespace {
    /** Provider for local binary files. */
    readonly FileProvider: IFileProviderConstructor;
    /** Provider for HTTP/HTTPS URLs (read-only). */
    readonly HttpProvider: IHttpProviderConstructor;
    /** Transformer for archive entry extraction/replacement (ZIP write, multi-format read). */
    readonly ArchiveTransformer: IArchiveTransformerConstructor;
    /** Transformer for AES-GCM decryption/encryption (non-persistent). */
    readonly DecryptTransformer: IDecryptTransformerConstructor;
    /**
     * Create an ILinkData from a raw link string.
     * @example
     * await app.events.openRawLink.sendAsync(io.createLinkData("C:\\file.txt"));
     * await app.events.openRawLink.sendAsync(io.createLinkData("https://example.com", {
     *     target: "browser",
     *     browserMode: "incognito",
     * }));
     */
    createLinkData(href: string, options?: Partial<Omit<ILinkData, "href" | "handled">>): ILinkData;
    /**
     * Convert an ILink to ILinkData — preserves all ILink fields through the pipeline.
     * @example
     * await app.events.openRawLink.sendAsync(io.linkToLinkData(link));
     */
    linkToLinkData(link: ILink): ILinkData;
    /**
     * Register a provider factory for this renderer session.
     *
     * Factories are called with descriptor configuration and may return a plain object
     * implementing the IProvider shape. Re-registering a script-owned type replaces it and
     * reports an info notification; platform-owned types remain first-wins and report an error.
     * Registrations survive script completion and autoload re-execution, but a renderer
     * reload/restart clears them. Existing live pipes keep their current provider object.
     *
     * @example
     * io.registerProvider("memory", (config) => ({
     *     type: "memory", displayName: "Memory", sourceUrl: "memory://item",
     *     restorable: true, writable: false,
     *     readBinary: async () => Buffer.from(String(config.text ?? "")),
     *     toDescriptor: () => ({ type: "memory", config }),
     * }));
     */
    registerProvider(type: string, factory: IProviderFactory): void;
    /**
     * Register parse and resolve hooks for a URL scheme in this renderer session.
     * Hooks must use `context.delegate()` to enter the existing openRawLink → openLink →
     * openContent pipeline. In `source-path` phase, resolve should build the pipe and return
     * without delegating into page opening. Script-owned re-registration replaces the prior
     * script entry with an info report; platform-owned schemes remain first-wins with an error.
     * Registrations are cleared by a renderer reload/restart, and replacements affect only
     * subsequent dispatches; existing live pipes are unchanged.
     *
     * @example
     * io.registerScheme("memory", {
     *     async parse(data, context) {
     *         data.url = data.href;
     *         data.handled = false;
     *         await context.delegate();
     *         data.handled = true;
     *     },
     *     async resolve(data, context) {
     *         data.target = "monaco";
     *         data.pipeDescriptor = { provider: { type: "memory", config: {} }, transformers: [] };
     *         data.pipe = context.createPipe(data.pipeDescriptor);
     *         if (context.phase === "source-path") return;
     *         data.handled = false;
     *         await context.delegate();
     *         data.handled = true;
     *     },
     * });
     */
    registerScheme(scheme: string, hooks: ISchemeHooks): void;
    /** Create a content pipe from a provider and optional transformers. */
    createPipe(provider: IProvider, ...transformers: ITransformer[]): IContentPipe;
}
