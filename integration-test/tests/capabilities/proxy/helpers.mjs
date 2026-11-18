import net from "node:net";

class SocketReader {
    constructor(socket) {
        this.socket = socket;
        this.chunks = [];
        this.size = 0;
        this.error = null;
        this.waiters = [];
        this.onData = (chunk) => {
            this.chunks.push(chunk);
            this.size += chunk.length;
            this.wake();
        };
        this.onError = (error) => { this.error = error; this.wake(); };
        this.onEnd = () => { this.error ??= new Error("Proxy client closed the connection."); this.wake(); };
        socket.on("data", this.onData);
        socket.on("error", this.onError);
        socket.on("end", this.onEnd);
        socket.on("close", this.onEnd);
    }

    wake() {
        for (const resolve of this.waiters.splice(0)) resolve();
    }

    take(length) {
        const output = Buffer.allocUnsafe(length);
        let offset = 0;
        while (offset < length) {
            const first = this.chunks[0];
            const copied = Math.min(first.length, length - offset);
            first.copy(output, offset, 0, copied);
            offset += copied;
            this.size -= copied;
            if (copied === first.length) this.chunks.shift();
            else this.chunks[0] = first.subarray(copied);
        }
        return output;
    }

    async read(length) {
        while (this.size < length) {
            if (this.error) throw this.error;
            await new Promise((resolve) => this.waiters.push(resolve));
        }
        return this.take(length);
    }

    async readHeaders(maxBytes = 16384) {
        while (true) {
            const all = Buffer.concat(this.chunks, this.size);
            const end = all.indexOf("\r\n\r\n");
            if (end >= 0) return this.take(end + 4).toString("latin1");
            if (this.size > maxBytes) throw new Error("Proxy request headers are too large.");
            if (this.error) throw this.error;
            await new Promise((resolve) => this.waiters.push(resolve));
        }
    }

    detach() {
        if (this.size) this.socket.unshift(Buffer.concat(this.chunks, this.size));
        this.chunks = [];
        this.size = 0;
        this.socket.removeListener("data", this.onData);
        this.socket.removeListener("error", this.onError);
        this.socket.removeListener("end", this.onEnd);
        this.socket.removeListener("close", this.onEnd);
    }
}

function parseFixtureTarget(host, port, fixtureUrl) {
    const fixture = new URL(fixtureUrl);
    const fixturePort = Number(fixture.port || 80);
    const normalizedHost = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (Number(port) !== fixturePort) throw new Error("Proxy fixture refused a target outside its local fixture port.");
    if (normalizedHost === "fixture.invalid") return { host: "127.0.0.1", port: fixturePort };
    if (normalizedHost === fixture.hostname.toLowerCase() && normalizedHost === "127.0.0.1") {
        return { host: "127.0.0.1", port: fixturePort };
    }
    throw new Error("Proxy fixture refused a non-fixture target.");
}

function createProxyServer(handler, fixtureUrl) {
    const server = net.createServer((client) => {
        const reader = new SocketReader(client);
        const upstreams = new Set();
        sockets.add(client);
        client.once("close", () => sockets.delete(client));
        void handler(client, reader, fixtureUrl, (upstream) => {
            upstreams.add(upstream);
            sockets.add(upstream);
            upstream.once("close", () => { upstreams.delete(upstream); sockets.delete(upstream); });
            client.once("close", () => upstream.destroy());
            upstream.once("close", () => client.destroy());
            reader.detach();
            client.pipe(upstream);
            upstream.pipe(client);
        }).catch(() => client.destroy());
    });
    const sockets = new Set();
    let closePromise;
    return {
        server,
        sockets,
        async listen() {
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(0, "127.0.0.1", resolve);
            });
            return server.address().port;
        },
        close() {
            closePromise ??= new Promise((resolve) => {
                if (!server.listening) return resolve();
                server.close(() => resolve());
                server.closeAllConnections?.();
                for (const socket of sockets) socket.destroy();
            });
            return closePromise;
        },
    };
}

function decodeSocksAddress(type, reader) {
    if (type === 1) return reader.read(4).then((bytes) => [...bytes].join("."));
    if (type === 3) return reader.read(1).then(async ([length]) => (await reader.read(length)).toString("utf8"));
    if (type === 4) return reader.read(16).then((bytes) => {
        const parts = [];
        for (let offset = 0; offset < bytes.length; offset += 2) parts.push(bytes.readUInt16BE(offset).toString(16));
        return parts.join(":");
    });
    throw new Error("Unsupported SOCKS5 target address type.");
}

export async function startSocks5Proxy({ fixtureUrl, credentials } = {}) {
    const record = { connectionCount: 0, connections: [] };
    const proxy = createProxyServer(async (client, reader, targetUrl, tunnel) => {
        record.connectionCount += 1;
        const [version, methodCount] = await reader.read(2);
        if (version !== 5 || methodCount < 1) throw new Error("Invalid SOCKS5 greeting.");
        const methods = await reader.read(methodCount);
        const authRequired = Boolean(credentials);
        const selectedMethod = authRequired ? 2 : 0;
        if (!methods.includes(selectedMethod)) {
            client.write(Buffer.from([5, 255]));
            return;
        }
        client.write(Buffer.from([5, selectedMethod]));
        let observedCredentials = null;
        if (selectedMethod === 2) {
            const [authVersion, usernameLength] = await reader.read(2);
            if (authVersion !== 1) throw new Error("Invalid SOCKS5 authentication version.");
            const username = (await reader.read(usernameLength)).toString("utf8");
            const [passwordLength] = await reader.read(1);
            const password = (await reader.read(passwordLength)).toString("utf8");
            observedCredentials = { username, password };
            const matches = username === credentials.username && password === credentials.password;
            client.write(Buffer.from([1, matches ? 0 : 1]));
            if (!matches) return;
        }
        const [requestVersion, command, reserved, addressType] = await reader.read(4);
        if (requestVersion !== 5 || command !== 1 || reserved !== 0) throw new Error("Unsupported SOCKS5 request.");
        const host = await decodeSocksAddress(addressType, reader);
        const [portBytes] = await Promise.all([reader.read(2)]);
        const port = portBytes.readUInt16BE(0);
        record.connections.push({ protocol: "socks5", host, port, credentials: observedCredentials });
        const destination = parseFixtureTarget(host, port, targetUrl);
        const upstream = net.connect(destination.port, destination.host);
        await new Promise((resolve, reject) => {
            upstream.once("connect", resolve);
            upstream.once("error", reject);
        });
        client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, destination.port >> 8, destination.port & 255]));
        tunnel(upstream);
    }, fixtureUrl);
    const port = await proxy.listen();
    return { port, record, close: () => proxy.close() };
}

export async function startHttpConnectProxy({ fixtureUrl, credentials } = {}) {
    const record = { connectionCount: 0, connections: [] };
    const proxy = createProxyServer(async (client, reader, targetUrl, tunnel) => {
        record.connectionCount += 1;
        const headers = await reader.readHeaders();
        const firstLine = headers.split("\r\n", 1)[0];
        const match = /^CONNECT ([^\s]+) HTTP\/1\.[01]$/.exec(firstLine);
        if (!match) throw new Error("Expected an HTTP CONNECT request.");
        const authority = match[1];
        const separator = authority.lastIndexOf(":");
        const host = authority.startsWith("[") ? authority.slice(1, authority.indexOf("]")) : authority.slice(0, separator);
        const port = Number(authority.slice(separator + 1));
        const authHeader = headers.split("\r\n").find((line) => /^proxy-authorization:/i.test(line));
        let observedCredentials = null;
        if (authHeader) {
            const token = /^proxy-authorization:\s*Basic\s+([^\s]+)/i.exec(authHeader)?.[1];
            const decoded = token ? Buffer.from(token, "base64").toString("utf8") : ":";
            const colon = decoded.indexOf(":");
            observedCredentials = { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
        }
        record.connections.push({ protocol: "http-connect", host, port, authority, credentials: observedCredentials });
        if (credentials && (observedCredentials?.username !== credentials.username || observedCredentials?.password !== credentials.password)) {
            client.end("HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\n\r\n");
            return;
        }
        const destination = parseFixtureTarget(host, port, targetUrl);
        const upstream = net.connect(destination.port, destination.host);
        await new Promise((resolve, reject) => {
            upstream.once("connect", resolve);
            upstream.once("error", reject);
        });
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        tunnel(upstream);
    }, fixtureUrl);
    const port = await proxy.listen();
    return { port, record, close: () => proxy.close() };
}

export async function reserveClosedPort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    return port;
}
