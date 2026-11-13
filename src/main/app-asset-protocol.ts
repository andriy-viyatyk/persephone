import { net, session } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAssetPath } from "./utils";

export const APP_ASSET_CORS_ALLOWLIST = [
    "vendor/dtln-aec/dtln_aec_128_1.onnx",
    "vendor/dtln-aec/dtln_aec_128_2.onnx",
    "vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm",
] as const;

export const APP_ASSET_SCHEME_PRIVILEGES: Electron.CustomScheme = {
    scheme: "app-asset",
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        // Cross-origin renderer fetches need this for editor declarations and WASM assets.
        corsEnabled: true,
    },
};

export function registerAppAssetProtocol(partition: string): void {
    const customSession = session.fromPartition(partition);
    customSession.protocol.handle("app-asset", async (request) => {
        const parsedUrl = new URL(request.url);
        let relativePath = path.join(parsedUrl.host, parsedUrl.pathname);

        if (relativePath.startsWith(path.sep) || relativePath.startsWith("/")) {
            relativePath = relativePath.substring(1);
        }

        const file = path.join(getAssetPath(), relativePath);
        const fileUrl = pathToFileURL(file).toString();
        const response = await net.fetch(fileUrl, { bypassCustomProtocolHandlers: true });
        const normalizedPath = relativePath.replace(/\\/g, "/");
        if (!APP_ASSET_CORS_ALLOWLIST.includes(normalizedPath as typeof APP_ASSET_CORS_ALLOWLIST[number])) {
            return response;
        }

        const headers = new Headers(response.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    });
}

