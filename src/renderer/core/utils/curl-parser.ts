/**
 * Parse HTTP requests from clipboard text (cURL bash/cmd, fetch, fetch Node.js).
 *
 * Shared utility used by:
 * - Content pipeline cURL parser (Layer 1 on openRawLink)
 * - Rest Client editor (paste into request builder)
 */

export interface ParsedHttpRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
}

/**
 * Auto-detect format and parse clipboard text into an HTTP request.
 * Returns null if the text doesn't match any known format.
 *
 * Supported formats:
 * - Copy as cURL (bash): `curl 'URL' -H 'key: value' ...`
 * - Copy as cURL (cmd): `curl "URL" -H "key: value" ...` with ^ escaping
 * - Copy as fetch: `fetch("URL", { headers: { ... } })`
 * - Copy as fetch (Node.js): same as fetch
 */
export function parseHttpRequest(text: string): ParsedHttpRequest | null {
    const trimmed = text.trim();
    if (trimmed.startsWith("fetch(")) return parseFetch(trimmed);
    if (/^curl\s/i.test(trimmed)) return parseCurl(trimmed);
    return null;
}

// =============================================================================
// cURL parser
// =============================================================================

function parseCurl(text: string): ParsedHttpRequest | null {
    try {
        // Normalize: remove line continuations (bash \ and cmd ^)
        const normalized = text
            .replace(/\^\n/g, " ")
            .replace(/\\\n/g, " ")
            .replace(/\^"/g, '"')
            .replace(/\^\^/g, "^");

        const tokens = tokenize(normalized);
        if (tokens.length < 2 || tokens[0].toLowerCase() !== "curl") return null;

        let url = "";
        let method = "";
        const headers: Record<string, string> = {};
        let body = "";
        let cookies = "";

        let i = 1;
        while (i < tokens.length) {
            const token = tokens[i];

            if (token === "-H" || token === "--header") {
                i++;
                if (i < tokens.length) {
                    const colonIdx = tokens[i].indexOf(":");
                    if (colonIdx > 0) {
                        const key = tokens[i].substring(0, colonIdx).trim();
                        const value = tokens[i].substring(colonIdx + 1).trim();
                        headers[key] = value;
                    }
                }
            } else if (token === "-X" || token === "--request") {
                i++;
                if (i < tokens.length) method = tokens[i].toUpperCase();
            } else if (token === "--url") {
                i++;
                if (i < tokens.length) url = tokens[i];
            } else if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary" || token === "--data-urlencode") {
                i++;
                if (i < tokens.length) body = tokens[i];
            } else if (token === "-b" || token === "--cookie") {
                i++;
                if (i < tokens.length) cookies = tokens[i];
            } else if (
                token === "--compressed" || token === "-L" || token === "--location" ||
                token === "-s" || token === "--silent" || token === "-k" || token === "--insecure" ||
                token === "-v" || token === "--verbose" || token === "-i" || token === "--include"
            ) {
                // Skip known flags without arguments
            } else if (!token.startsWith("-")) {
                if (!url) url = token;
            }

            i++;
        }

        if (cookies) {
            headers["Cookie"] = cookies;
        }

        if (!method) {
            method = body ? "POST" : "GET";
        }

        if (!url) return null;

        return { url, method, headers, body };
    } catch {
        return null;
    }
}

// =============================================================================
// Fetch parser
// =============================================================================

function parseFetch(text: string): ParsedHttpRequest | null {
    try {
        const urlMatch = text.match(/^fetch\(\s*["'](.*?)["']/);
        if (!urlMatch) return null;
        const url = urlMatch[1];

        let method = "GET";
        const headers: Record<string, string> = {};
        let body = "";

        const optionsStart = text.indexOf("{", text.indexOf(urlMatch[0]) + urlMatch[0].length);
        if (optionsStart !== -1) {
            const optionsStr = extractBalancedBraces(text, optionsStart);
            if (optionsStr) {
                const options = parseRelaxedJSON(optionsStr);
                if (options) {
                    if (options.method) method = String(options.method).toUpperCase();
                    if (options.headers && typeof options.headers === "object") {
                        for (const [key, value] of Object.entries(options.headers)) {
                            headers[key] = String(value);
                        }
                    }
                    if (options.body && options.body !== "null") {
                        body = String(options.body);
                    }
                }
            }
        }

        return { url, method, headers, body };
    } catch {
        return null;
    }
}

// =============================================================================
// Shared utilities
// =============================================================================

/** Tokenize a command string respecting single and double quotes. */
function tokenize(text: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let inQuote = false;
    let quoteChar = "";
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (escaped) {
            if (quoteChar === "'") current += "\\";
            current += ch;
            escaped = false;
            continue;
        }

        if (ch === "\\" && quoteChar !== "'") {
            escaped = true;
            continue;
        }

        if (inQuote) {
            if (ch === quoteChar) {
                inQuote = false;
            } else {
                current += ch;
            }
            continue;
        }

        if (ch === '"' || ch === "'") {
            inQuote = true;
            quoteChar = ch;
            continue;
        }

        if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
            if (current) {
                tokens.push(current);
                current = "";
            }
            continue;
        }

        current += ch;
    }

    if (current) tokens.push(current);
    return tokens;
}

/** Extract a balanced { ... } substring starting at the given index. */
function extractBalancedBraces(text: string, start: number): string | null {
    if (text[start] !== "{") return null;
    let depth = 0;
    let inString = false;
    let stringChar = "";
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escaped) { escaped = false; continue; }
        if (ch === "\\") { escaped = true; continue; }

        if (inString) {
            if (ch === stringChar) inString = false;
            continue;
        }

        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            continue;
        }

        if (ch === "{") depth++;
        if (ch === "}") {
            depth--;
            if (depth === 0) return text.substring(start, i + 1);
        }
    }
    return null;
}

/** Parse a JSON-like object that may have unquoted keys or trailing commas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRelaxedJSON(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        try {
            const fixed = text
                .replace(/'/g, '"')
                .replace(/,\s*([}\]])/g, "$1");
            return JSON.parse(fixed);
        } catch {
            return null;
        }
    }
}
