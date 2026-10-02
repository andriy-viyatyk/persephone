/**
 * Node.js HTTP client — bypasses Chromium's network stack for full header control.
 *
 * Uses Node's http/https modules directly (available because nodeIntegration: true).
 * No automatic headers (Origin, User-Agent, Sec-Fetch-*, etc.) are injected.
 * Returns a standard web Response object.
 *
 * Used by:
 *  - `app.fetch()` — script API for HTTP requests
 *  - Rest Client editor — for executing requests
 *
 * Based on the proven implementation in av-player/src/main/network/nodeHttpFetch.ts.
 */

import type { IFetchOptions } from "./types/app";
import { TorChannel } from "../../ipc/tor-ipc";
import { settings } from "./settings";
import { agentFor, parseProxy, type ProxyRoute } from "./proxy-tunnel";

const https = require("https") as typeof import("https");
const http = require("http") as typeof import("http");
const zlib = require("zlib") as typeof import("zlib");
const dns = require("dns").promises as typeof import("dns/promises");
const net = require("net") as typeof import("net");
const { ipcRenderer } = require("electron") as typeof import("electron");

/** Default HTTPS agent with keep-alive for connection reuse. */
const defaultHttpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 8,
    keepAliveMsecs: 30000,
    timeout: 60000,
    rejectUnauthorized: true,
});

/** HTTPS agent that skips SSL certificate validation. */
const insecureHttpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 8,
    keepAliveMsecs: 30000,
    timeout: 60000,
    rejectUnauthorized: false,
});

export function nodeFetch(
    url: string,
    options?: IFetchOptions & { boardNetworkPolicy?: BoardNetworkPolicy },
): Promise<Response> {
    const method = options?.method ?? "GET";
    const headers = options?.headers ?? {};
    const body = options?.body ?? null;
    const timeout = options?.timeout ?? 30000;
    const maxRedirects = options?.maxRedirects ?? 10;
    const rejectUnauthorized = options?.rejectUnauthorized !== false;

    return (async () => {
        if (options?.tor && options.proxy) throw new TypeError("fetch: use either `tor` or `proxy`, not both.");
        const lease = options?.tor ? await acquireTorRoute(options.signal) : undefined;
        const route = lease?.route ?? (options?.proxy ? parseProxy(options.proxy) : undefined);
        try {
            const response = await doFetch(url, method, headers, body, timeout, maxRedirects,
                rejectUnauthorized, options?.signal, route, options?.boardNetworkPolicy);
            return lease ? releaseWithBody(response, lease.release, options?.signal) : response;
        } catch (error: unknown) {
            lease?.release();
            throw error;
        }
    })();
}

interface TorRouteLease {
    route: ProxyRoute;
    release(): void;
}

export interface BoardNetworkPolicy { network: false | "internet" | "full"; appScripting: boolean; mcpUrl: string }

async function acquireTorRoute(signal?: AbortSignal): Promise<TorRouteLease> {
    if (signal?.aborted) throw new Error("The HTTP request was aborted.");
    await settings.wait();
    if (signal?.aborted) throw new Error("The HTTP request was aborted.");
    const torExePath = settings.get<string>("tor.exe-path");
    const socksPort = settings.get<number>("tor.socks-port");
    const acquire = ipcRenderer.invoke(
        TorChannel.fetchAcquire, torExePath, socksPort,
    ) as Promise<{ success: true; socksPort: number } | { success: false; error: string }>;
    let released = false;
    const release = (): void => {
        if (released) return;
        released = true;
        ipcRenderer.send(TorChannel.fetchRelease);
    };
    if (!signal) {
        const result = await acquire;
        if (result.success === false) throw new Error(result.error);
        return { route: { kind: "socks5", host: "127.0.0.1", port: result.socksPort }, release };
    }
    let abortListener: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(new Error("The HTTP request was aborted."));
        signal.addEventListener("abort", abortListener, { once: true });
    });
    try {
        const result = await Promise.race([acquire, aborted]);
        if (result.success === false) throw new Error(result.error);
        return { route: { kind: "socks5", host: "127.0.0.1", port: result.socksPort }, release };
    } catch (error: unknown) {
        void acquire.then((result) => { if (result.success) release(); }, () => {});
        throw error;
    } finally {
        if (abortListener) signal.removeEventListener("abort", abortListener);
    }
}

function releaseWithBody(response: Response, release: () => void, signal?: AbortSignal): Response {
    const body = response.body;
    if (!body) { release(); return response; }
    const reader = body.getReader();
    let finished = false;
    const finish = (): void => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", finish);
        release();
    };
    if (signal?.aborted) finish();
    else signal?.addEventListener("abort", finish, { once: true });
    const wrapped = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const result = await reader.read();
                if (result.done) { finish(); controller.close(); }
                else controller.enqueue(result.value);
            } catch (error: unknown) { finish(); controller.error(error); }
        },
        async cancel(reason) {
            try { await reader.cancel(reason); } finally { finish(); }
        },
    });
    return new Response(wrapped, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function doFetch(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | ReadableStream | null,
    timeout: number,
    maxRedirects: number,
    rejectUnauthorized: boolean,
    signal?: AbortSignal,
    route?: ProxyRoute,
    boardPolicy?: BoardNetworkPolicy,
): Promise<Response> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === "https:";

        const prepare = async (): Promise<{ address?: string; family?: number }> => {
            if (!boardPolicy) return {};
            if (boardPolicy.network === false) throw new Error('permission-denied: "network" is not enabled in board-manifest.json');
            const port = Number(urlObj.port || (isHttps ? 443 : 80));
            const mcp = new URL(boardPolicy.mcpUrl);
            const targetHost = urlObj.hostname.replace(/^\[|\]$/g, "");
            const mcpHost = mcp.hostname.replace(/^\[|\]$/g, "");
            if (!boardPolicy.appScripting && targetHost.toLowerCase() === mcpHost.toLowerCase()
                && port === Number(mcp.port || (mcp.protocol === "https:" ? 443 : 80))) {
                throw new Error('permission-denied: "appScripting" is not enabled in board-manifest.json');
            }
            const family = net.isIP(targetHost);
            const addresses = family ? [{ address: targetHost, family }]
                : await dns.lookup(targetHost, { all: true, verbatim: true });
            if (!addresses.length) throw new Error(`DNS resolution returned no addresses for ${targetHost}.`);
            const mcpFamily = net.isIP(mcpHost);
            const mcpAddresses = mcpFamily ? [{ address: mcpHost, family: mcpFamily }]
                : await dns.lookup(mcpHost, { all: true, verbatim: true })
                    .catch((): { address: string; family: number }[] => []);
            if (!boardPolicy.appScripting && port === Number(mcp.port || (mcp.protocol === "https:" ? 443 : 80))
                && addresses.some(({ address }) => mcpAddresses.some((mcpAddress) => address === mcpAddress.address))) {
                throw new Error('permission-denied: "appScripting" is not enabled in board-manifest.json');
            }
            if (boardPolicy.network === "internet" && addresses.some(({ address }) => isPrivateAddress(address))) {
                throw new Error('permission-denied: "network" is not enabled in board-manifest.json');
            }
            return route ? {} : { address: addresses[0].address, family: addresses[0].family };
        };

        void prepare().then((pinned) => {

        if (route && !isHttps && urlObj.protocol !== "http:") {
            reject(new TypeError(`Unsupported protocol: ${urlObj.protocol}`));
            return;
        }
        const agent = route
            ? agentFor(route, isHttps, rejectUnauthorized)
            : isHttps ? (rejectUnauthorized ? defaultHttpsAgent : insecureHttpsAgent) : undefined;

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method,
            headers,
            agent,
            timeout,
            ...(pinned.address ? { lookup: (_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => callback(null, pinned.address!, pinned.family!) } : {}),
        };

        const lib = isHttps ? https : http;
        const req = lib.request(reqOptions, (res) => {
            // Handle redirects (301, 302, 303, 307, 308)
            if (
                res.statusCode &&
                [301, 302, 303, 307, 308].includes(res.statusCode)
            ) {
                const location = res.headers.location;

                if (!location) {
                    res.destroy();
                    reject(new Error(`Redirect ${res.statusCode} without Location header`));
                    return;
                }

                if (maxRedirects <= 0) {
                    res.destroy();
                    reject(new Error("Too many redirects"));
                    return;
                }

                // The active HTTP response owns this end listener until the redirect
                // response is drained; a view/model disposer must not touch the request.
                // Drain the redirect response body
                res.resume();
                res.on("end", () => {});

                const redirectUrl = location.startsWith("http")
                    ? location
                    : new URL(location, url).toString();

                // 303 always switches to GET; 301/302 switch POST to GET
                const newMethod =
                    res.statusCode === 303 ||
                    (method === "POST" && [301, 302].includes(res.statusCode))
                        ? "GET"
                        : method;

                const redirectHeaders = { ...headers };
                const redirectUrlObj = new URL(redirectUrl);

                // Update Host header for the new target
                redirectHeaders["Host"] = redirectUrlObj.host;

                // Update Sec-Fetch-Site if present
                const isCrossOrigin = urlObj.origin !== redirectUrlObj.origin;
                if (redirectHeaders["Sec-Fetch-Site"]) {
                    redirectHeaders["Sec-Fetch-Site"] = isCrossOrigin
                        ? "cross-site"
                        : "same-origin";
                }

                // Strip body-related headers on method change to GET
                if (newMethod === "GET") {
                    delete redirectHeaders["Content-Length"];
                    delete redirectHeaders["Content-Type"];
                    delete redirectHeaders["Origin"];
                }

                // Cancel the original body stream if switching to GET
                if (body && typeof body !== "string" && newMethod === "GET") {
                    body.cancel().catch(() => {});
                }

                doFetch(
                    redirectUrl,
                    newMethod,
                    redirectHeaders,
                    newMethod === "GET" ? null : body,
                    timeout,
                    maxRedirects - 1,
                    rejectUnauthorized,
                    signal,
                    route,
                    boardPolicy,
                ).then(resolve, reject);

                return;
            }

            // Build response headers
            const responseHeaders = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
                responseHeaders.set(k, Array.isArray(v) ? v.join(", ") : v || "");
            }

            // Decompression
            const contentEncoding = res.headers["content-encoding"];
            let responseStream = res as NodeJS.ReadableStream;

            if (contentEncoding === "gzip") {
                responseStream = res.pipe(zlib.createGunzip());
            } else if (contentEncoding === "deflate") {
                responseStream = res.pipe(zlib.createInflate());
            } else if (contentEncoding === "br") {
                responseStream = res.pipe(zlib.createBrotliDecompress());
            } else if (contentEncoding === "zstd") {
                // createZstdDecompress was added in Node 23; not yet in @types/node.
                const z = zlib as typeof zlib & { createZstdDecompress(): NodeJS.ReadWriteStream };
                responseStream = res.pipe(z.createZstdDecompress());
            }

            // The response/readable stream owns these callbacks until it ends or is
            // cancelled; they are request-lifetime resources, not view/model resources.
            if (responseStream !== res) {
                responseStream.on("error", (err) => {
                    console.error("nodeFetch decompression error:", err);
                    res.destroy();
                });
            }

            // Remove content-encoding since we've decompressed
            responseHeaders.delete("content-encoding");

            // Wrap Node stream as web ReadableStream
            let isCancelled = false;
            let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
            const readableStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    bodyController = controller;
                    responseStream.on("data", (chunk) => {
                        if (!isCancelled) {
                            try {
                                controller.enqueue(new Uint8Array(chunk));
                                if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                                    (responseStream as NodeJS.ReadableStream & { pause?(): void }).pause?.();
                                }
                            } catch {
                                // Stream likely cancelled
                            }
                        }
                    });

                    responseStream.on("end", () => {
                        if (!isCancelled) {
                            try {
                                controller.close();
                            } catch {
                                // Already closed
                            }
                        }
                    });

                    responseStream.on("error", (err) => {
                        if (!isCancelled) {
                            try {
                                controller.error(err);
                            } catch {
                                // Already closed
                            }
                        }
                    });
                },
                pull() {
                    (responseStream as NodeJS.ReadableStream & { resume?(): void }).resume?.();
                },
                cancel() {
                    isCancelled = true;
                    if (responseStream !== res) {
                        (responseStream as NodeJS.ReadableStream & { destroy?(): void }).destroy?.();
                    }
                    res.destroy();
                    responseStream.removeAllListeners();
                },
            });
            signal?.addEventListener("abort", () => {
                if (responseStream !== res) {
                    (responseStream as NodeJS.ReadableStream & { destroy?(): void }).destroy?.();
                }
                res.destroy();
                // A destroyed response emits neither "end" nor "error", so without this a
                // reader waiting on the body would never settle after an abort.
                if (!isCancelled) {
                    isCancelled = true;
                    try {
                        bodyController?.error(new DOMException("The HTTP request was aborted.", "AbortError"));
                    } catch {
                        // Already closed
                    }
                }
            }, { once: true });

            // Some status codes have no body
            const hasBody = method !== "HEAD" &&
                res.statusCode &&
                res.statusCode !== 101 &&
                res.statusCode !== 103 &&
                res.statusCode !== 204 &&
                res.statusCode !== 205 &&
                res.statusCode !== 304;

            resolve(
                new Response(hasBody ? readableStream : null, {
                    status: res.statusCode || 200,
                    statusText: res.statusMessage || "OK",
                    headers: responseHeaders,
                }),
            );
        });

        // The request owns its timeout/error listeners through completion or failure.
        req.on("timeout", () => {
            req.destroy();
            reject(new Error(`Request timeout [${timeout}ms]: ${url}`));
        });

        req.on("error", (err) => {
            reject(err);
        });

        if (signal?.aborted) {
            req.destroy();
            reject(new Error("The HTTP request was aborted."));
        } else {
            signal?.addEventListener("abort", () => {
                req.destroy();
                reject(new Error("The HTTP request was aborted."));
            }, { once: true });
        }

        // Send request body
        if (body && typeof body === "string") {
            req.end(body);
        } else if (body) {
            const reader = (body as ReadableStream).getReader();
            const pump = async () => {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        req.end();
                        return;
                    }
                    req.write(value);
                    await pump();
                } catch (err) {
                    req.destroy();
                    reject(err);
                }
            };
            pump();
        } else {
            req.end();
        }
        }).catch(reject);
    });
}

function isPrivateAddress(address: string): boolean {
    const value = address.toLowerCase().split("%", 1)[0];
    const family = net.isIP(value);
    if (family === 4) {
        const [a, b] = value.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    if (family === 6) {
        if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
        return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd")
            || /^fe[89ab]/.test(value);
    }
    return true;
}
