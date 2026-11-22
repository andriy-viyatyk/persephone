import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function suitePath(relative) {
    return fileURLToPath(new URL(relative, import.meta.url));
}

export async function startStaticServer(siteDirectory) {
    const html = await readFile(path.join(siteDirectory, "index.html"));
    const server = createServer((request, response) => {
        if (request.url !== "/" && request.url !== "/index.html") {
            response.writeHead(404).end("Not found");
            return;
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
    });

    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        await new Promise((resolve) => server.close(resolve));
        throw new Error("The local fixture server did not receive a TCP address.");
    }

    return {
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        }),
    };
}
