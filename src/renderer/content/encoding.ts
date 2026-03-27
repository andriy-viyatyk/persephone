/**
 * Text encoding detection and conversion utilities.
 *
 * Extracted from fs.ts for use by ContentPipe. Handles BOM detection,
 * jschardet-based encoding detection, and iconv-lite encoding/decoding.
 */

const iconv = require("iconv-lite");
const jschardet = require("jschardet");

export interface DecodedText {
    content: string;
    encoding: string;
}

const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024; // 20MB

/**
 * Decode a binary buffer to string with automatic encoding detection.
 *
 * Detection order:
 * 1. BOM (UTF-8-BOM, UTF-16LE, UTF-16BE) — O(1)
 * 2. Skip detection for files >20MB (use UTF-8)
 * 3. Explicit encoding override (if provided)
 * 4. jschardet detection (>70% confidence)
 * 5. UTF-8 without replacement characters
 * 6. Fallback: Windows-1251
 */
export function decodeBuffer(buffer: Buffer, encoding?: string): DecodedText {
    // BOM detection
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return { content: buffer.slice(3).toString("utf-8"), encoding: "utf-8-bom" };
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return { content: iconv.decode(buffer.slice(2), "utf16le"), encoding: "utf-16le" };
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        return { content: iconv.decode(buffer.slice(2), "utf16be"), encoding: "utf-16be" };
    }

    // Large files: skip detection
    if (buffer.length > LARGE_FILE_THRESHOLD) {
        return { content: buffer.toString("utf-8"), encoding: "utf-8" };
    }

    // Explicit encoding override
    if (encoding) {
        try {
            return { content: iconv.decode(buffer, encoding), encoding };
        } catch {
            // Fall through to auto-detection
        }
    }

    // jschardet detection
    const detected = jschardet.detect(buffer);
    if (detected && detected.encoding && detected.confidence > 0.7) {
        try {
            let detectedEncoding = detected.encoding.toLowerCase();
            if (detectedEncoding === "ascii") {
                detectedEncoding = "utf-8";
            }
            return { content: iconv.decode(buffer, detectedEncoding), encoding: detectedEncoding };
        } catch {
            // Fall through
        }
    }

    // UTF-8 without replacement characters
    try {
        const utf8Text = buffer.toString("utf-8");
        if (!utf8Text.includes("\ufffd")) {
            return { content: utf8Text, encoding: "utf-8" };
        }
    } catch {
        // Fall through
    }

    // Final fallback
    return { content: iconv.decode(buffer, "windows-1251"), encoding: "windows-1251" };
}

/**
 * Encode a string into a binary buffer with the specified encoding.
 * Includes BOM for UTF-8-BOM, UTF-16LE, UTF-16BE.
 */
export function encodeString(content: string, encoding?: string): Buffer {
    const enc = encoding?.toLowerCase() || "utf-8";

    if (enc === "utf-8" || enc === "utf8") {
        return Buffer.from(content, "utf-8");
    } else if (enc === "utf-8-bom" || enc === "utf8bom") {
        const bom = Buffer.from([0xef, 0xbb, 0xbf]);
        return Buffer.concat([bom, Buffer.from(content, "utf-8")]);
    } else if (enc === "utf-16le" || enc === "utf16le") {
        const bom = Buffer.from([0xff, 0xfe]);
        return Buffer.concat([bom, iconv.encode(content, "utf16le")]);
    } else if (enc === "utf-16be" || enc === "utf16be") {
        const bom = Buffer.from([0xfe, 0xff]);
        return Buffer.concat([bom, iconv.encode(content, "utf16be")]);
    } else {
        try {
            return iconv.encode(content, enc);
        } catch {
            return Buffer.from(content, "utf-8");
        }
    }
}
