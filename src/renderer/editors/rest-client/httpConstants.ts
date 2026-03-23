export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export const COMMON_HEADERS = [
    "Accept",
    "Accept-Charset",
    "Accept-Encoding",
    "Accept-Language",
    "Authorization",
    "Cache-Control",
    "Connection",
    "Content-Disposition",
    "Content-Length",
    "Content-Type",
    "Cookie",
    "DNT",
    "Host",
    "If-Match",
    "If-Modified-Since",
    "If-None-Match",
    "If-Range",
    "If-Unmodified-Since",
    "Origin",
    "Pragma",
    "Range",
    "Referer",
    "TE",
    "Upgrade",
    "User-Agent",
    "Via",
    "X-API-Key",
    "X-CSRF-Token",
    "X-Forwarded-For",
    "X-Forwarded-Host",
    "X-Forwarded-Proto",
    "X-Request-ID",
    "X-Requested-With",
];

import universalColors from "../../theme/universal-colors";

export const METHOD_COLORS: Record<string, string> = {
    GET: universalColors.http.method.get,
    POST: universalColors.http.method.post,
    PUT: universalColors.http.method.put,
    PATCH: universalColors.http.method.patch,
    DELETE: universalColors.http.method.delete,
    HEAD: universalColors.http.method.head,
    OPTIONS: universalColors.http.method.options,
};
