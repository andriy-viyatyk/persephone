import type { ITransformer, ITransformerDescriptor } from "../../api/types/io.transformer";

/**
 * ZipTransformer — extracts/replaces a single entry in a ZIP archive.
 *
 * Read:  full ZIP bytes → extract entryPath → entry content bytes
 * Write: new content + original ZIP bytes → replace entry → full ZIP bytes
 *
 * Uses jszip via dynamic import (same as archive-service.ts).
 */
export class ZipTransformer implements ITransformer {
    readonly type = "zip";
    readonly persistent = true;
    readonly config: Record<string, unknown>;

    constructor(private readonly entryPath: string) {
        this.config = { entryPath };
    }

    async read(data: Buffer): Promise<Buffer> {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(data);
        const file = zip.file(this.entryPath);
        if (!file) {
            throw new Error(`Entry not found in archive: ${this.entryPath}`);
        }
        return file.async("nodebuffer");
    }

    async write(data: Buffer, original: Buffer): Promise<Buffer> {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(original);
        zip.file(this.entryPath, data);
        return zip.generateAsync({
            type: "nodebuffer",
            compression: "DEFLATE",
            compressionOptions: { level: 6 },
        });
    }

    toDescriptor(): ITransformerDescriptor {
        return {
            type: "zip",
            config: { entryPath: this.entryPath },
        };
    }
}
