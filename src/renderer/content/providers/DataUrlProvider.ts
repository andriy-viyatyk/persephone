import type { IProvider, IProviderDescriptor } from "../../api/types/io.provider";

/**
 * DataUrlProvider — reads content from data: URLs.
 *
 * Decodes `data:[<mediatype>][;base64],<data>` format.
 * Read-only, fully restorable (content is self-contained in the URL).
 * Used for inline scripts/styles extracted from HTML pages.
 */
export class DataUrlProvider implements IProvider {
    readonly type = "data";
    readonly restorable = true;
    readonly writable = false;
    readonly sourceUrl: string;
    readonly displayName: string;

    constructor(private readonly dataUrl: string) {
        this.sourceUrl = dataUrl;
        // Extract a short display name from the media type
        const match = dataUrl.match(/^data:([^;,]*)/);
        const mediaType = match?.[1] || "unknown";
        this.displayName = `data:${mediaType}`;
    }

    async readBinary(): Promise<Buffer> {
        const commaIndex = this.dataUrl.indexOf(",");
        if (commaIndex < 0) {
            throw new Error("Invalid data URL: missing comma separator");
        }
        const header = this.dataUrl.slice(0, commaIndex);
        const body = this.dataUrl.slice(commaIndex + 1);

        if (header.endsWith(";base64")) {
            return Buffer.from(body, "base64");
        }
        // Plain text encoding (percent-encoded)
        return Buffer.from(decodeURIComponent(body), "utf-8");
    }

    toDescriptor(): IProviderDescriptor {
        return {
            type: "data",
            config: { url: this.dataUrl },
        };
    }

    dispose(): void {}
}
