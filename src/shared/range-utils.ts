/** Inclusive byte range used by HTTP Range requests and content providers. */
export interface ByteRange {
    start: number;
    end: number;
}

/** Parse the single-range form supported by the app's streaming endpoints. */
export function parseRangeHeader(
    rangeHeader: string,
    totalSize: number,
): ByteRange | null {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) return null;

    const [, startStr, endStr] = match;
    let start: number;
    let end: number;

    if (!startStr && endStr) {
        // Suffix range: bytes=-500 means last 500 bytes
        const suffixLen = parseInt(endStr, 10);
        start = Math.max(0, totalSize - suffixLen);
        end = totalSize - 1;
    } else {
        start = startStr ? parseInt(startStr, 10) : 0;
        end = endStr ? parseInt(endStr, 10) : totalSize - 1;
    }

    if (start > end || start >= totalSize) return null;
    end = Math.min(end, totalSize - 1);

    return { start, end };
}

export function contentRangeHeader(range: ByteRange, totalSize: number): string {
    return `bytes ${range.start}-${range.end}/${totalSize}`;
}

export function unsatisfiableContentRangeHeader(totalSize: number): string {
    return `bytes */${totalSize}`;
}

export function contentLength(range: ByteRange): number {
    return range.end - range.start + 1;
}
