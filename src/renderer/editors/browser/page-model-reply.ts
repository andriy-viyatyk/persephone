import { shapeResult, type IAiRemoteResponse } from "ai-vision";

/** Applies the host's length policy while the remote response metadata is still available. */
export function normalizePageModelReply(
    response: IAiRemoteResponse,
    maxLength: number,
    webMcp: boolean,
): IAiRemoteResponse {
    if (!response.ok) return response;

    const shaped = webMcp ? shapeResult(response.result, maxLength) : undefined;
    const truncated = webMcp ? shaped?.truncated : response.truncated;
    if (truncated) {
        const shown = webMcp ? shaped?.shown : response.shown;
        const total = webMcp ? shaped?.total : response.total;
        const totalLength = webMcp ? shaped?.totalLength : response.totalLength;
        const detail = shown !== undefined && total !== undefined
            ? `showing ${shown} of ${total} items`
            : totalLength !== undefined ? `${totalLength} characters total` : "reply exceeded the limit";
        return {
            ok: false,
            code: "result-truncated",
            error: `Page model reply exceeded maxLength (${maxLength}; ${detail}); raise maxLength to receive more.`,
        };
    }
    return webMcp ? { ok: true, result: shaped?.result } : response;
}
