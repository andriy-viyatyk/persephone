import { errMessage } from "../../shared/utils";

/** Node socket tunnels used by routed `nodeFetch` requests. */
const net = require("net") as typeof import("net");
const tls = require("tls") as typeof import("tls");
const http = require("http") as typeof import("http");
const https = require("https") as typeof import("https");

export type ProxyRoute =
    | { kind: "socks5"; host: string; port: number; username?: string; password?: string }
    | { kind: "http"; host: string; port: number; username?: string; password?: string };

function invalidProxy(problem: string): TypeError {
    return new TypeError(`fetch: invalid proxy ${problem}.`);
}

export function parseProxy(value: string): ProxyRoute {
    const shorthand = /^(?:\[[0-9a-f:]+\]|[^:/?#]+):\d+$/i.test(value);
    const input = shorthand ? `socks5://${value}` : value;
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw invalidProxy("URL");
    }
    const kind = url.protocol === "http:" ? "http"
        : url.protocol === "socks5:" || url.protocol === "socks5h:" ? "socks5" : undefined;
    if (!kind) throw invalidProxy("scheme (use socks5://, socks5h://, or http://)");
    // A non-special scheme such as `socks5:` parses with an empty pathname, `http:` with "/".
    if (!url.hostname || !url.port || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
        throw invalidProxy("endpoint (expected scheme://host:port)");
    }
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalidProxy("port");
    let username: string | undefined;
    let password: string | undefined;
    try {
        if (url.username || url.password) {
            username = decodeURIComponent(url.username);
            password = decodeURIComponent(url.password);
        }
    } catch {
        throw invalidProxy("credentials");
    }
    return { kind, host: url.hostname.replace(/^\[|\]$/g, ""), port, username, password };
}

class SocketReader {
    private chunks: Buffer[] = [];
    private size = 0;
    private failed: Error | undefined;
    private waiters: Array<() => void> = [];

    constructor(private readonly socket: import("net").Socket) {
        socket.on("data", this.onData);
        socket.on("error", this.onError);
        socket.on("end", this.onEnd);
        socket.on("close", this.onEnd);
    }

    private readonly onData = (chunk: Buffer): void => {
        this.chunks.push(chunk);
        this.size += chunk.length;
        this.wake();
    };
    private readonly onError = (error: Error): void => { this.failed = error; this.wake(); };
    private readonly onEnd = (): void => { this.failed ??= new Error("Proxy closed the connection."); this.wake(); };

    private wake(): void { for (const wake of this.waiters.splice(0)) wake(); }

    async read(length: number): Promise<Buffer> {
        while (this.size < length) {
            if (this.failed) throw this.failed;
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
        const output = Buffer.allocUnsafe(length);
        let offset = 0;
        while (offset < length) {
            const first = this.chunks[0];
            const take = Math.min(first.length, length - offset);
            first.copy(output, offset, 0, take);
            offset += take;
            this.size -= take;
            if (take === first.length) this.chunks.shift();
            else this.chunks[0] = first.subarray(take);
        }
        return output;
    }

    async readUntil(marker: Buffer, maxBytes: number): Promise<Buffer> {
        while (true) {
            const all = Buffer.concat(this.chunks, this.size);
            const index = all.indexOf(marker);
            if (index >= 0) {
                const end = index + marker.length;
                this.chunks = end < all.length ? [all.subarray(end)] : [];
                this.size = all.length - end;
                return all.subarray(0, end);
            }
            if (this.size > maxBytes) throw new Error("Proxy response headers are too large.");
            if (this.failed) throw this.failed;
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
    }

    unshiftRemainder(): void {
        if (this.size) this.socket.unshift(Buffer.concat(this.chunks, this.size));
        this.chunks = [];
        this.size = 0;
        this.socket.removeListener("data", this.onData);
        this.socket.removeListener("error", this.onError);
        this.socket.removeListener("end", this.onEnd);
        this.socket.removeListener("close", this.onEnd);
    }
}

function waitForConnect(socket: import("net").Socket, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => socket.destroy(new Error(`Proxy connect timed out after ${timeoutMs}ms.`)), timeoutMs);
        socket.once("connect", () => { clearTimeout(timer); resolve(); });
        socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
}

const socksReplyErrors: Record<number, string> = {
    1: "general failure", 2: "connection not allowed", 3: "network unreachable",
    4: "host unreachable", 5: "connection refused", 6: "TTL expired",
    7: "command not supported", 8: "address type not supported",
};

async function openSocksTunnel(route: Extract<ProxyRoute, { kind: "socks5" }>, targetHost: string,
    targetPort: number, timeoutMs: number): Promise<import("net").Socket> {
    const socket = net.connect(route.port, route.host) as import("net").Socket;
    const tunnelTimer = setTimeout(() => socket.destroy(new Error(`Proxy tunnel timed out after ${timeoutMs}ms.`)), timeoutMs);
    try {
        await waitForConnect(socket, timeoutMs);
        const reader = new SocketReader(socket);
        const auth = route.username !== undefined;
        socket.write(Buffer.from(auth ? [5, 2, 0, 2] : [5, 1, 0]));
        const greeting = await reader.read(2);
        if (greeting[0] !== 5 || greeting[1] === 255) throw new Error("SOCKS5 proxy rejected authentication methods.");
        if (greeting[1] === 2) {
            const routeUsername = route.username;
            if (routeUsername === undefined) throw new Error("SOCKS5 proxy requires username and password.");
            const username = Buffer.from(routeUsername, "utf8");
            const password = Buffer.from(route.password ?? "", "utf8");
            if (username.length > 255 || password.length > 255) throw new Error("SOCKS5 credentials exceed 255 bytes.");
            socket.write(Buffer.concat([Buffer.from([1, username.length]), username, Buffer.from([password.length]), password]));
            const authReply = await reader.read(2);
            if (authReply[1] !== 0) throw new Error("SOCKS5 username/password authentication failed.");
        } else if (greeting[1] !== 0) {
            throw new Error(`SOCKS5 proxy selected unsupported authentication method ${greeting[1]}.`);
        }
        targetHost = targetHost.replace(/^\[|\]$/g, "");
        const ipType = net.isIP(targetHost);
        let address: Buffer;
        if (ipType === 4) address = Buffer.concat([Buffer.from([1]), Buffer.from(targetHost.split(".").map(Number))]);
        else if (ipType === 6) {
            const block = targetHost.split("::");
            const left = block[0] ? block[0].split(":") : [];
            const right = block[1] ? block[1].split(":") : [];
            const words = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
                .flatMap((part) => part.includes(".") ? ["0", "0"] : [part]);
            if (words.length !== 8) throw new Error("Invalid IPv6 target address.");
            address = Buffer.concat([Buffer.from([4]), ...words.map((word) => {
                const bytes = Buffer.alloc(2); bytes.writeUInt16BE(parseInt(word || "0", 16)); return bytes;
            })]);
        } else {
            const host = Buffer.from(targetHost, "utf8");
            if (!host.length || host.length > 255) throw new Error("SOCKS5 target host must be 1–255 bytes.");
            address = Buffer.concat([Buffer.from([3, host.length]), host]);
        }
        const port = Buffer.alloc(2); port.writeUInt16BE(targetPort);
        socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, port]));
        const head = await reader.read(4);
        if (head[0] !== 5 || head[2] !== 0) throw new Error("Malformed SOCKS5 proxy reply.");
        if (head[1] !== 0) throw new Error(`SOCKS5 CONNECT failed: ${socksReplyErrors[head[1]] ?? `reply ${head[1]}`}.`);
        const addrLength = head[3] === 1 ? 4 : head[3] === 4 ? 16 : head[3] === 3 ? (await reader.read(1))[0] : -1;
        if (addrLength < 0) throw new Error("Malformed SOCKS5 bound address.");
        await reader.read(addrLength + 2);
        reader.unshiftRemainder();
        clearTimeout(tunnelTimer);
        return socket;
    } catch (error) {
        clearTimeout(tunnelTimer);
        socket.destroy();
        throw error;
    }
}

async function openHttpTunnel(route: Extract<ProxyRoute, { kind: "http" }>, targetHost: string,
    targetPort: number, timeoutMs: number): Promise<import("net").Socket> {
    const socket = net.connect(route.port, route.host) as import("net").Socket;
    const tunnelTimer = setTimeout(() => socket.destroy(new Error(`Proxy tunnel timed out after ${timeoutMs}ms.`)), timeoutMs);
    try {
        await waitForConnect(socket, timeoutMs);
        const reader = new SocketReader(socket);
        const authority = targetHost.includes(":") ? `[${targetHost}]:${targetPort}` : `${targetHost}:${targetPort}`;
        const auth = route.username !== undefined
            ? `Proxy-Authorization: Basic ${Buffer.from(`${route.username}:${route.password ?? ""}`).toString("base64")}\r\n`
            : "";
        socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n`);
        const headers = (await reader.readUntil(Buffer.from("\r\n\r\n"), 65536)).toString("latin1");
        const status = headers.split("\r\n", 1)[0];
        const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(status);
        if (!match || Number(match[1]) < 200 || Number(match[1]) >= 300) throw new Error(`HTTP proxy CONNECT failed: ${status || "malformed response"}.`);
        reader.unshiftRemainder();
        clearTimeout(tunnelTimer);
        return socket;
    } catch (error) {
        clearTimeout(tunnelTimer);
        socket.destroy();
        throw error;
    }
}

function openTunnel(route: ProxyRoute, targetHost: string, targetPort: number, timeoutMs: number): Promise<import("net").Socket> {
    return route.kind === "socks5"
        ? openSocksTunnel(route, targetHost, targetPort, timeoutMs)
        : openHttpTunnel(route, targetHost, targetPort, timeoutMs);
}

const agentCache = new Map<string, import("http").Agent>();

export function agentFor(route: ProxyRoute, isHttps: boolean, rejectUnauthorized: boolean): import("http").Agent {
    const key = JSON.stringify([route, isHttps, rejectUnauthorized]);
    const cached = agentCache.get(key);
    if (cached) { agentCache.delete(key); agentCache.set(key, cached); return cached; }
    const Agent = isHttps ? https.Agent : http.Agent;
    const agent = new Agent({ keepAlive: true, maxSockets: 8, keepAliveMsecs: 30000, timeout: 60000,
        ...(isHttps ? { rejectUnauthorized } : {}),
    });
    agent.createConnection = ((options: import("net").NetConnectOpts & { host?: string; port?: number; servername?: string }, callback?: (error: Error | null, socket?: import("net").Socket) => void) => {
        void openTunnel(route, options.host ?? "", options.port ?? (isHttps ? 443 : 80), Number(options.timeout) || 30000)
            .then((socket) => {
                if (!isHttps) { callback?.(null, socket); return; }
                const secureSocket = tls.connect({ socket, servername: options.servername || options.host,
                    rejectUnauthorized, ALPNProtocols: ["http/1.1"], });
                // Only a handshake failure goes to the callback; once connected, the
                // socket belongs to the agent and later errors surface on the request.
                const onHandshakeError = (error: Error) => callback?.(error);
                secureSocket.once("error", onHandshakeError);
                secureSocket.once("secureConnect", () => {
                    secureSocket.removeListener("error", onHandshakeError);
                    callback?.(null, secureSocket);
                });
            }, (error: unknown) => callback?.(new Error(errMessage(error))));
        return undefined;
    }) as typeof agent.createConnection;
    agentCache.set(key, agent);
    if (agentCache.size > 16) {
        const oldestKey = agentCache.keys().next().value as string | undefined;
        if (oldestKey !== undefined) { agentCache.get(oldestKey)?.destroy(); agentCache.delete(oldestKey); }
    }
    return agent;
}
