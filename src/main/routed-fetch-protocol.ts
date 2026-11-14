import { session } from "electron";
import { errMessage } from "../shared/utils";

export interface RoutedUrl {
    parsed: URL;
    host: string;
    target: string | null;
}

export function parseRoutedUrl(url: string): RoutedUrl {
    // `?u=` rather than a path segment: Chromium may rewrite percent-escapes
    // in standard-scheme paths, corrupting a target URL that carries escapes.
    const parsed = new URL(url);
    return { parsed, host: parsed.host, target: parsed.searchParams.get("u") };
}

export function isHttpUrl(url: string): boolean {
    return /^https?:$/.test(safeProtocol(url));
}

/** Protocol of `url`, or "" when it does not parse. Never throws. */
function safeProtocol(url: string): string {
    try {
        return new URL(url).protocol;
    } catch {
        return "";
    }
}

export type RoutedPartitionResult =
    | { partition: string }
    | { status: number; body: string };

export interface RoutedFetchOptions {
    scheme: string;
    resolvePartition: (host: string) => RoutedPartitionResult;
    failurePrefix: string;
    extraHeaders?: Record<string, string>;
}

export function createRoutedFetchHandler(options: RoutedFetchOptions):
    (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
        let host: string;
        let target: string | null;
        try {
            ({ host, target } = parseRoutedUrl(request.url));
        } catch {
            return new Response(`Malformed ${options.scheme} URL`, { status: 400 });
        }
        if (!target) return new Response("Missing 'u' target parameter", { status: 400 });

        const resolution = options.resolvePartition(host);
        if ("status" in resolution) return new Response(resolution.body, { status: resolution.status });
        if (!isHttpUrl(target)) return new Response("Only http(s) targets are allowed", { status: 403 });

        let upstream: Response;
        try {
            // Electron's session fetch keeps the route's proxy policy and default redirect behavior.
            upstream = await session.fromPartition(resolution.partition).fetch(target);
        } catch (error: unknown) {
            return new Response(`${options.failurePrefix}: ${errMessage(error)}`, { status: 502 });
        }

        // Forward the body and content type only; upstream cookies stay out of the app session.
        // Profile CORS lets the favicon cache read bytes with renderer `fetch()`.
        const headers = new Headers({ "Cache-Control": "no-store", ...options.extraHeaders });
        const contentType = upstream.headers.get("content-type");
        if (contentType) headers.set("Content-Type", contentType);
        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers,
        });
    };
}
