function detectBodyType(headers, body, isFormUrlencode) {
    if (isFormUrlencode || getContentType(headers).includes("x-www-form-urlencoded")) {
        return { bodyType: "form-urlencoded", bodyLanguage: "plaintext", formData: parseUrlEncodedBody(body) };
    }
    if (!body) return { bodyType: "none", bodyLanguage: "plaintext", formData: [] };
    const contentType = getContentType(headers);
    let bodyLanguage = "plaintext";
    if (contentType.includes("json")) bodyLanguage = "json";
    else if (contentType.includes("javascript")) bodyLanguage = "javascript";
    else if (contentType.includes("html")) bodyLanguage = "html";
    else if (contentType.includes("xml")) bodyLanguage = "xml";
    return { bodyType: "raw", bodyLanguage, formData: [] };
}

function getContentType(headers) {
    return (headers.find(header => header.key.toLowerCase() === "content-type")?.value || "").toLowerCase();
}

function parseUrlEncodedBody(body) {
    if (!body) return [];
    return body.split("&").filter(Boolean).map(pair => {
        const eqIndex = pair.indexOf("=");
        const key = eqIndex >= 0 ? decodeURIComponent(pair.substring(0, eqIndex)) : decodeURIComponent(pair);
        const value = eqIndex >= 0 ? decodeURIComponent(pair.substring(eqIndex + 1)) : "";
        return { key, value, enabled: true };
    });
}

export function parseClipboardRequest(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("fetch(")) return parseFetch(trimmed);
    if (/^curl\s/i.test(trimmed)) return parseCurl(trimmed);
    return null;
}

function parseFetch(text) {
    try {
        const urlMatch = text.match(/^fetch\(\s*["'](.*?)["']/);
        if (!urlMatch) return null;
        const url = urlMatch[1];
        let method = "GET";
        const headers = [];
        let body = "";
        const optionsStart = text.indexOf("{", text.indexOf(urlMatch[0]) + urlMatch[0].length);
        if (optionsStart !== -1) {
            const optionsText = extractBalancedBraces(text, optionsStart);
            if (optionsText) {
                const parsed = parseRelaxedJSON(optionsText);
                const options = parsed && typeof parsed === "object" ? parsed : null;
                if (options) {
                    if (options.method) method = String(options.method).toUpperCase();
                    if (options.headers && typeof options.headers === "object") {
                        for (const [key, value] of Object.entries(options.headers)) {
                            headers.push({ key, value: String(value), enabled: true });
                        }
                    }
                    if (options.body && options.body !== "null") body = String(options.body);
                }
            }
        }
        return { method, url, headers, body, ...detectBodyType(headers, body, false) };
    } catch {
        return null;
    }
}

function extractBalancedBraces(text, start) {
    if (text[start] !== "{") return null;
    let depth = 0;
    let inString = false;
    let stringChar = "";
    let escaped = false;
    for (let index = start; index < text.length; index++) {
        const character = text[index];
        if (escaped) { escaped = false; continue; }
        if (character === "\\") { escaped = true; continue; }
        if (inString) {
            if (character === stringChar) inString = false;
            continue;
        }
        if (character === '"' || character === "'") { inString = true; stringChar = character; continue; }
        if (character === "{") depth++;
        if (character === "}" && --depth === 0) return text.substring(start, index + 1);
    }
    return null;
}

function parseRelaxedJSON(text) {
    try {
        return JSON.parse(text);
    } catch {
        try {
            const fixed = text.replace(/'/g, '"').replace(/,\s*([}\]])/g, "$1");
            return JSON.parse(fixed);
        } catch {
            return null;
        }
    }
}

function parseCurl(text) {
    try {
        const normalized = text
            .replace(/\^\n/g, " ")
            .replace(/\\\n/g, " ")
            .replace(/\^"/g, '"')
            .replace(/\^\^/g, "^");
        const tokens = tokenizeCurl(normalized);
        if (tokens.length < 2 || tokens[0].toLowerCase() !== "curl") return null;
        let url = "";
        let method = "";
        const headers = [];
        let body = "";
        let cookies = "";
        let isFormUrlencode = false;
        let index = 1;
        while (index < tokens.length) {
            const token = tokens[index];
            if (token === "-H" || token === "--header") {
                index++;
                if (index < tokens.length) {
                    const header = tokens[index];
                    const colonIndex = header.indexOf(":");
                    if (colonIndex > 0) headers.push({
                        key: header.substring(0, colonIndex).trim(),
                        value: header.substring(colonIndex + 1).trim(),
                        enabled: true,
                    });
                }
            } else if (token === "-X" || token === "--request") {
                index++;
                if (index < tokens.length) method = tokens[index].toUpperCase();
            } else if (token === "--data-urlencode") {
                index++;
                if (index < tokens.length) {
                    isFormUrlencode = true;
                    body = body ? `${body}&${tokens[index]}` : tokens[index];
                }
            } else if (["-d", "--data", "--data-raw", "--data-binary"].includes(token)) {
                index++;
                if (index < tokens.length) body = tokens[index];
            } else if (token === "-b" || token === "--cookie") {
                index++;
                if (index < tokens.length) cookies = tokens[index];
            } else if (!["--compressed", "-L", "--location", "-s", "--silent", "-k", "--insecure"].includes(token) && !token.startsWith("-")) {
                if (!url) url = token;
            }
            index++;
        }
        if (cookies) headers.push({ key: "Cookie", value: cookies, enabled: true });
        if (!method) method = body ? "POST" : "GET";
        if (!url) return null;
        return { method, url, headers, body, ...detectBodyType(headers, body, isFormUrlencode) };
    } catch {
        return null;
    }
}

function tokenizeCurl(text) {
    const tokens = [];
    let current = "";
    let inQuote = false;
    let quoteChar = "";
    let escaped = false;
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (escaped) {
            if (quoteChar === "'") current += "\\";
            current += character;
            escaped = false;
            continue;
        }
        if (character === "\\" && quoteChar !== "'") { escaped = true; continue; }
        if (inQuote) {
            if (character === quoteChar) inQuote = false;
            else current += character;
            continue;
        }
        if (character === '"' || character === "'") { inQuote = true; quoteChar = character; continue; }
        if ([" ", "\t", "\n", "\r"].includes(character)) {
            if (current) { tokens.push(current); current = ""; }
            continue;
        }
        current += character;
    }
    if (current) tokens.push(current);
    return tokens;
}
