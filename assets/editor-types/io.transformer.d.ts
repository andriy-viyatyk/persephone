/** Serializable transformer descriptor for persistence. */
export interface ITransformerDescriptor {
    /** Transformer type (e.g., "zip", "gunzip", "base64"). */
    type: string;
    /** Transformer-specific configuration (e.g., { entryPath: "data/report.csv" }). */
    config: Record<string, unknown>;
}

/**
 * ITransformer — knows *how to process* bytes.
 *
 * Transformers sit between provider and editor in the content pipe.
 * They transform bytes on read (source → editor) and optionally
 * reverse-transform on write (editor → source).
 */
export interface ITransformer {
    /** Transformer type identifier (e.g., "zip", "decrypt", "gunzip"). */
    readonly type: string;
    /** Configuration used to construct this transformer. */
    readonly config: Record<string, unknown>;
    /** Whether this transformer should be included in saved pipe descriptor.
     *  false for DecryptTransformer (contains password — must not persist to disk). */
    readonly persistent: boolean;
    /** Transform bytes on read (source → editor). */
    read(data: Buffer): Promise<Buffer>;
    /** Reverse-transform bytes on write (editor → source).
     *  Receives new content and original source bytes (needed by ZIP to rebuild archive). */
    write(data: Buffer, original: Buffer): Promise<Buffer>;
    /** Create a deep copy of this transformer (avoids descriptor round-trip). */
    clone(): ITransformer;
    /** Serialize to descriptor for persistence. */
    toDescriptor(): ITransformerDescriptor;
}
