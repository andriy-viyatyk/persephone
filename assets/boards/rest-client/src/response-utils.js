export const RESPONSE_LANGUAGES = Object.freeze(["json", "html", "xml", "javascript", "css", "yaml", "plaintext"]);
const EXTENSIONS = Object.freeze({
    "application/json": "json", "text/json": "json", "text/html": "html", "application/xhtml+xml": "html",
    "application/xml": "xml", "text/xml": "xml", "application/javascript": "javascript", "text/javascript": "javascript",
    "text/css": "css", "application/yaml": "yaml", "text/yaml": "yaml", "application/x-yaml": "yaml",
});

export function isBinaryContentType(contentType = "") {
    const normalized = contentType.toLowerCase();
    if (normalized.startsWith("text/")) return false;
    if (["json", "xml", "javascript", "css", "html", "yaml", "form-urlencoded"].some(type => normalized.includes(type))) return false;
    if (normalized.startsWith("image/") || normalized.startsWith("audio/") || normalized.startsWith("video/")) return true;
    if (["octet-stream", "pdf", "zip", "gzip"].some(type => normalized.includes(type))) return true;
    return false;
}

export function inferResponseLanguage(contentType = "") {
    const normalized = contentType.split(";")[0].trim().toLowerCase();
    if (EXTENSIONS[normalized]) return EXTENSIONS[normalized];
    if (normalized.endsWith("+json")) return "json";
    if (normalized.endsWith("+xml")) return "xml";
    return "plaintext";
}

export function formatResponseBody(body, language) {
    if (language !== "json") return body;
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}

export function formatByteSize(bytes) {
    const locale = persephone.locale.code;
    if (!Number.isFinite(bytes) || bytes < 0) return `${new Intl.NumberFormat(locale).format(0)} B`;
    if (bytes < 1024) return `${new Intl.NumberFormat(locale).format(bytes)} B`;
    const units = ["KB", "MB", "GB"];
    let size = bytes / 1024;
    let unit = units[0];
    for (let index = 1; size >= 1024 && index < units.length; index += 1) {
        size /= 1024;
        unit = units[index];
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: size >= 10 ? 0 : 1 }).format(size)} ${unit}`;
}

export function byteLength(text) { return new TextEncoder().encode(text).byteLength; }

export function contentTypeExtension(contentType = "") {
    const normalized = contentType.split(";")[0].trim().toLowerCase();
    const known = EXTENSIONS[normalized];
    if (known) return known;
    if (normalized.startsWith("image/")) return normalized.slice(6).replace("jpeg", "jpg").split("+")[0] || "img";
    if (normalized === "application/pdf") return "pdf";
    return "bin";
}
