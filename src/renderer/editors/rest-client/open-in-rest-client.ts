/**
 * Open a URL in the RestClient editor.
 * Handles both cURL-parsed metadata (method, headers, body) and plain URLs.
 */
import type { ILinkData } from "../../../shared/link-data";
import type { RestClientData } from "./restClientTypes";
import { createDefaultRequest } from "./restClientTypes";

export async function openInRestClient(
    url: string,
    data?: ILinkData,
): Promise<void> {
    const { pagesModel } = await import("../../api/pages");

    const request = createDefaultRequest(requestName(url));
    request.url = url;

    if (data?.method) {
        request.method = data.method;
    }

    if (data?.headers) {
        request.headers = Object.entries(data.headers).map(
            ([key, value]) => ({ key, value: String(value), enabled: true }),
        );
    }

    if (data?.body) {
        request.body = data.body;
        request.bodyType = "raw";
        const contentType = data.headers?.["Content-Type"]
            || data.headers?.["content-type"] || "";
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

    const restClientData: RestClientData = {
        type: "rest-client",
        requests: [request],
    };

    pagesModel.addEditorPage(
        "rest-client",
        "json",
        restClientTitle(url),
        JSON.stringify(restClientData, null, 4),
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
