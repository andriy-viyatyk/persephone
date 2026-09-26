
/** Serializable provider descriptor for persistence. */
export interface IProviderDescriptor {
    /** Provider type (e.g., "file", "http", "buffer"). */
    type: string;
    /** Provider-specific configuration (e.g., { path: "C:\\file.txt" }). */
    config: Record<string, unknown>;
}

/** File/resource metadata. */
export interface IProviderStat {
    /** File size in bytes. */
    size?: number;
    /** Last modification time (ISO string). */
    mtime?: string;
    /** Whether the resource exists. */
    exists: boolean;
}

/**
 * IProvider — knows *where* to get bytes.
 *
 * Providers are data sources: local files, HTTP URLs, in-memory buffers.
 * They read/write raw binary content. Text encoding is handled separately
 * by EncodingTransformer.
 */
export interface IProvider {
    /** Provider type identifier (e.g., "file", "http", "buffer"). */
    readonly type: string;
    /** Display name for UI (filename, URL, etc.). */
    readonly displayName: string;
    /** Original URL/path that created this provider. */
    readonly sourceUrl: string;
    /** Whether this provider can be restored from a descriptor after app restart.
     *  Non-restorable providers (e.g., BufferProvider) return empty content after restore. */
    readonly restorable: boolean;
    /** Whether this provider supports writing. */
    readonly writable: boolean;
    /** Read binary content from the source. `options.signal`, when present, is aborted once
     *  Persephone stops waiting on this read (page close, cancellation); honoring it is optional,
     *  tolerating its presence is mandatory (US-1518). */
    readBinary(options?: { signal?: AbortSignal }): Promise<Buffer>;
    /**
     * Create a readable stream from the source with an optional byte range.
     * Used for large binary content (video, audio) where loading the full
     * buffer into memory is impractical.
     * Optional — providers that do not support streaming should omit this method.
     * The range end is inclusive (same as the HTTP Range header convention).
     * `options.signal`, when present, is aborted once Persephone stops waiting on this read;
     * honoring it is optional, tolerating its presence is mandatory (US-1518).
     */
    createReadStream?(
        range?: { start: number; end: number },
        options?: { signal?: AbortSignal },
    ): NodeJS.ReadableStream;
    /** Write binary content to the source. Only present if writable. */
    writeBinary?(data: Buffer): Promise<void>;
    /** Get resource metadata (size, modified date, existence). */
    stat?(): Promise<IProviderStat>;
    /** Watch for external changes. Returns a disposer to stop watching. */
    watch?(callback: (event: string) => void): () => void;
    /** Serialize to descriptor for persistence. */
    toDescriptor(): IProviderDescriptor;
    /** Release resources (file handles, connections, etc.). */
    dispose?(): void;
}
