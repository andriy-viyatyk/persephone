import type { WebContents } from "electron";
import type { NetworkLogEntry } from "../ipc/browser-ipc";

interface NetworkResponseRecord {
    sessionId?: string;
    requestId: string;
    url: string;
    method: string;
    wallTime?: number;
    response?: { mimeType: string; headers: Record<string, string> };
    finished: boolean;
}

interface NetworkResponseCollector {
    wc: WebContents;
    records: NetworkResponseRecord[];
}

type BoundedResponseBody = (
    body: string,
    base64Encoded: boolean,
    response: { mimeType: string; headers: Record<string, string> },
    maxBodyBytes: number,
) => { body: string; base64Encoded: boolean; truncated: boolean } | undefined;

export function createNetworkResponseBodyResolver(
    getCollector: (key: string) => NetworkResponseCollector | undefined,
    boundBody: BoundedResponseBody,
): (key: string, entries: NetworkLogEntry[], maxBodyBytes: number) => Promise<Map<number, {
    responseBody: string;
    responseBodyBase64Encoded: boolean;
    responseBodyTruncated: boolean;
}>> {
    return async (key, entries, maxBodyBytes) => {
        const collector = getCollector(key);
        const output = new Map<number, {
            responseBody: string;
            responseBodyBase64Encoded: boolean;
            responseBodyTruncated: boolean;
        }>();
        if (!collector || collector.wc.isDestroyed()) return output;
        const candidates = entries.map((entry) => collector.records.filter((record) =>
            record.finished && record.response && record.url === entry.url && record.method === entry.method
            && record.wallTime !== undefined && Math.abs(record.wallTime - entry.timestamp) <= 1000));
        for (let index = 0; index < entries.length; index++) {
            const matches = candidates[index];
            if (matches.length !== 1) continue;
            const record = matches[0];
            if (candidates.some((other, otherIndex) => otherIndex !== index && other.includes(record))) continue;
            try {
                const result = await collector.wc.debugger.sendCommand(
                    "Network.getResponseBody",
                    { requestId: record.requestId },
                    record.sessionId,
                );
                if (!isRecord(result) || typeof result.body !== "string") continue;
                const body = boundBody(
                    result.body,
                    result.base64Encoded === true,
                    record.response ?? { mimeType: "", headers: {} },
                    maxBodyBytes,
                );
                if (!body) continue;
                output.set(entries[index].id, {
                    responseBody: body.body,
                    responseBodyBase64Encoded: body.base64Encoded,
                    responseBodyTruncated: body.truncated,
                });
            } catch {
                // Chromium may already have discarded the body.
            }
        }
        return output;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
