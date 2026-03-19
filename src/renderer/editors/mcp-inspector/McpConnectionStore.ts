import { debounce } from "../../../shared/utils";
import { fs as appFs } from "../../api/fs";
import { TOneState } from "../../core/state/state";
import { McpTransportType } from "./McpConnectionManager";

// ============================================================================
// Types
// ============================================================================

export interface SavedMcpConnection {
    id: string;
    name: string;
    transport: McpTransportType;
    url: string;
    command: string;
    args: string;
    createdAt: number;
    lastUsedAt: number;
}

export interface McpConnectionStoreState {
    connections: SavedMcpConnection[];
}

// ============================================================================
// Store
// ============================================================================

const FILE_NAME = "mcp-connections.json";

class McpConnectionStore {
    private _loaded = false;

    readonly state = new TOneState<McpConnectionStoreState>({ connections: [] });

    /** Ensure connections are loaded from disk. Safe to call multiple times. */
    async load(): Promise<void> {
        if (this._loaded) return;
        this._loaded = true;
        try {
            await appFs.prepareDataFile(FILE_NAME, "[]");
            const content = await appFs.getDataFile(FILE_NAME);
            if (content) {
                const parsed = JSON.parse(content);
                const connections: SavedMcpConnection[] = Array.isArray(parsed) ? parsed : [];
                this.state.set({ connections });
            }
        } catch {
            // Start with empty list if file is corrupt
        }
    }

    /** Save or update a connection. Returns the saved connection. */
    async save(conn: {
        id?: string;
        name: string;
        transport: McpTransportType;
        url: string;
        command: string;
        args: string;
    }): Promise<SavedMcpConnection> {
        await this.load();
        const now = Date.now();
        const connections = [...this.state.get().connections];

        // Update existing by ID
        if (conn.id) {
            const idx = connections.findIndex((c) => c.id === conn.id);
            if (idx >= 0) {
                connections[idx] = { ...connections[idx], ...conn, lastUsedAt: now };
                this.state.set({ connections });
                this.writeToDisk();
                return connections[idx];
            }
        }

        // Check for duplicate by config
        const existing = this.findByConfig(conn.transport, conn.url, conn.command);
        if (existing) {
            const idx = connections.findIndex((c) => c.id === existing.id);
            if (idx >= 0) {
                connections[idx] = { ...connections[idx], name: conn.name, lastUsedAt: now };
                this.state.set({ connections });
                this.writeToDisk();
                return connections[idx];
            }
        }

        // Create new
        const saved: SavedMcpConnection = {
            id: crypto.randomUUID(),
            name: conn.name,
            transport: conn.transport,
            url: conn.url,
            command: conn.command,
            args: conn.args,
            createdAt: now,
            lastUsedAt: now,
        };
        connections.push(saved);
        this.state.set({ connections });
        this.writeToDisk();
        return saved;
    }

    /** Delete a connection by ID. */
    async delete(id: string): Promise<void> {
        await this.load();
        const connections = this.state.get().connections.filter((c) => c.id !== id);
        this.state.set({ connections });
        this.writeToDisk();
    }

    /** Find an existing connection matching transport + URL or command. */
    findByConfig(transport: McpTransportType, url: string, command: string): SavedMcpConnection | undefined {
        return this.state.get().connections.find((c) => {
            if (c.transport !== transport) return false;
            if (transport === "http") return c.url === url;
            return c.command === command;
        });
    }

    private writeToDisk = debounce(async () => {
        try {
            const data = this.state.get().connections;
            await appFs.saveDataFile(FILE_NAME, JSON.stringify(data, null, 4));
        } catch {
            // Silently fail — next save will retry
        }
    }, 500);
}

export const mcpConnectionStore = new McpConnectionStore();
