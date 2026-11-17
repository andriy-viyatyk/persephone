import net from "node:net";

export async function chooseMcpPort(requested?: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            if (requested !== undefined) {
                server.close((error) => error ? reject(error) : probeRequestedPort(requested).then(resolve, reject));
                return;
            }
            const address = server.address();
            if (!address || typeof address === "string") { server.close(); reject(new Error("Could not select an MCP port.")); return; }
            server.close((error) => error ? reject(error) : resolve(address.port));
        });
    });
}

function probeRequestedPort(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", () => reject(new Error(`Requested MCP port ${port} is already occupied.`)));
        server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve(port)));
    });
}
