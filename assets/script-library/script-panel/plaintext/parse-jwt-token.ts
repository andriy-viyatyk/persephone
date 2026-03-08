// Decode a JWT token — outputs formatted header and payload as JSON
// Paste a JWT token into the page and run this script.

let token: string = page.content.trim();

// Strip "Bearer " prefix (common when pasting Authorization headers)
if (token.toLowerCase().startsWith("bearer ")) {
    token = token.slice(7).trim();
}

const parts = token.split(".");
if (parts.length < 2) {
    return "Error: Not a valid JWT token (expected at least 2 dot-separated parts)";
}

function decodeBase64Url(str: string): string {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(
        atob(padded)
            .split("")
            .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
            .join("")
    );
}

const header = JSON.parse(decodeBase64Url(parts[0]));
const payload = JSON.parse(decodeBase64Url(parts[1]));

// Format expiration dates if present
if (payload.exp) {
    payload._exp_readable = new Date(payload.exp * 1000).toISOString();
}
if (payload.iat) {
    payload._iat_readable = new Date(payload.iat * 1000).toISOString();
}

return "// Header\n" + JSON.stringify(header, null, 2)
    + "\n\n// Payload\n" + JSON.stringify(payload, null, 2);
