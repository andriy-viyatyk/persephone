export const HTTP_METHODS = Object.freeze(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export const COMMON_HEADERS = Object.freeze([
    "Accept", "Accept-Charset", "Accept-Encoding", "Accept-Language", "Authorization", "Cache-Control",
    "Connection", "Content-Disposition", "Content-Length", "Content-Type", "Cookie", "DNT", "Host",
    "If-Match", "If-Modified-Since", "If-None-Match", "If-Range", "If-Unmodified-Since", "Origin", "Pragma",
    "Range", "Referer", "TE", "Upgrade", "User-Agent", "Via", "X-API-Key", "X-CSRF-Token",
    "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Request-ID", "X-Requested-With",
]);

export const BODY_TYPES = Object.freeze(["none", "form-data", "form-urlencoded", "raw", "binary"]);
export const CONTENT_TYPES = Object.freeze({
    json: "application/json", javascript: "application/javascript", html: "text/html", xml: "application/xml",
});
export const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
