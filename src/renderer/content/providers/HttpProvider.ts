import type { IProvider, IProviderDescriptor } from "../../api/types/io.provider";

/**
 * HttpProvider — reads content from HTTP/HTTPS URLs.
 *
 * Read-only provider. Uses nodeFetch (Node.js http/https) for full header control.
 * Supports method/headers/body for future cURL parser integration.
 * Re-fetches on each readBinary() call (no caching — page uses cache pipe for that).
 */
export class HttpProvider implements IProvider {
    readonly type = "http";
    readonly restorable = true;
    readonly writable = false;
    readonly sourceUrl: string;
    readonly displayName: string;

    private readonly url: string;
    private readonly method: string;
    private readonly headers: Record<string, string>;
    private readonly body: string | undefined;

    constructor(
        url: string,
        options?: { method?: string; headers?: Record<string, string>; body?: string },
    ) {
        this.url = url;
        this.sourceUrl = url;
        this.method = options?.method ?? "GET";
        this.headers = options?.headers ?? {};
        this.body = options?.body;

        try {
            const parsed = new URL(url);
            this.displayName = parsed.hostname + parsed.pathname;
        } catch {
            this.displayName = url;
        }
    }

    async readBinary(): Promise<Buffer> {
        const { nodeFetch } = await import("../../api/node-fetch");
        const response = await nodeFetch(this.url, {
            method: this.method,
            headers: this.headers,
            body: this.body,
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    toDescriptor(): IProviderDescriptor {
        return {
            type: "http",
            config: {
                url: this.url,
                ...(this.method !== "GET" && { method: this.method }),
                ...(Object.keys(this.headers).length > 0 && { headers: this.headers }),
                ...(this.body && { body: this.body }),
            },
        };
    }

    dispose(): void {}
}
