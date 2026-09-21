const http = require("node:http");
const https = require("node:https");

function requestText(url, redirects = 0) {
    if (redirects > 10) return Promise.reject(new Error("Too many redirects."));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return Promise.reject(new Error("Library URL must use HTTP or HTTPS."));
    }
    const transport = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
        const request = transport.get(url, (response) => {
            const status = response.statusCode || 0;
            const location = response.headers.location;
            if (status >= 300 && status < 400 && location) {
                response.resume();
                resolve(requestText(new URL(location, url), redirects + 1));
                return;
            }
            if (status < 200 || status >= 300) {
                response.resume();
                reject(new Error("Library download failed with HTTP " + status + "."));
                return;
            }
            const chunks = [];
            response.setEncoding("utf8");
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolve(chunks.join("")));
            response.on("error", reject);
        });
        request.on("error", reject);
    });
}

(async () => {
    try {
        const body = await requestText(new URL(process.argv[2]));
        process.stdout.write(body);
    } catch (error) {
        process.stderr.write((error && error.message) || String(error));
        process.exitCode = 1;
    }
})();
