/**
 * Open a URL in the RestClient editor.
 * Handles both cURL-parsed metadata (method, headers, body) and plain URLs.
 */
import type { ILinkMetadata } from "../../api/types/io.events";
import type { RestClientData } from "./restClientTypes";
import { createDefaultRequest } from "./restClientTypes";

export async function openInRestClient(
    url: string,
    metadata?: ILinkMetadata,
): Promise<void> {
    const { pagesModel } = await import("../../api/pages");

    const request = createDefaultRequest(requestName(url));
    request.url = url;

    if (metadata?.method) {
        request.method = metadata.method;
    }

    if (metadata?.headers) {
        request.headers = Object.entries(metadata.headers).map(
            ([key, value]) => ({ key, value: String(value), enabled: true }),
        );
    }

    if (metadata?.body) {
        request.body = metadata.body;
        request.bodyType = "raw";
        const contentType = metadata.headers?.["Content-Type"]
            || metadata.headers?.["content-type"] || "";
        if (contentType.includes("json")) {
            request.bodyLanguage = "json";
        } else if (contentType.includes("xml")) {
            request.bodyLanguage = "xml";
        } else if (contentType.includes("html")) {
            request.bodyLanguage = "html";
        } else if (contentType.includes("javascript")) {
            request.bodyLanguage = "javascript";
        }
    }

    const data: RestClientData = {
        type: "rest-client",
        requests: [request],
    };

    pagesModel.addEditorPage(
        "rest-client",
        "json",
        restClientTitle(url),
        JSON.stringify(data, null, 4),
    );
}

function requestName(url: string): string {
    try {
        const u = new URL(url);
        const segments = u.pathname.split("/").filter(Boolean);
        return segments.length > 0 ? segments[segments.length - 1] : u.hostname;
    } catch {
        return "Request";
    }
}

function restClientTitle(url: string): string {
    try {
        return new URL(url).hostname + ".rest.json";
    } catch {
        return "request.rest.json";
    }
}
