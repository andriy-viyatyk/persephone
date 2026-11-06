import { fs } from "../../api/fs";
import { fpIsAbsolute, fpJoin } from "../../core/utils/file-path";
import type { BoardServiceProvider } from "../../../ipc/board-bridge-channels";
import type { AgentSessionStarted } from "./AgentSessionChannel";
import type { AgentSessionProvider } from "./AgentSessionProvider";

export interface AgentSessionBinding { boardName: string; engine?: string; cwd: string; sessionId: string }
export type AgentSessionResume = { binding: AgentSessionBinding; provider: BoardServiceProvider } | { reason: string };

/** One owner must serialize access across windows; writes through this instance are ordered. */
export class AgentSessionStore {
    private writes: Promise<void> = Promise.resolve();
    public async workspace(): Promise<string> {
        const path = fpJoin(await fs.dataFileName("agent-session"), "workspace");
        if (!fpIsAbsolute(path)) throw new Error("Agent session workspace must be absolute.");
        await fs.mkdir(path);
        if (!(await fs.stat(path)).isDirectory) throw new Error("Unable to create agent session workspace.");
        return path;
    }
    public async load(provider: AgentSessionProvider): Promise<AgentSessionResume> {
        await this.writes;
        const path = await this.metadataPath();
        if (!await fs.exists(path)) return { reason: "No saved agent session." };
        const value: unknown = JSON.parse(await fs.read(path));
        if (!value || typeof value !== "object") throw new Error("Invalid agent session metadata.");
        const binding = value as Partial<AgentSessionBinding>;
        if (typeof binding.boardName !== "string" || !binding.boardName.trim() || typeof binding.cwd !== "string" || !fpIsAbsolute(binding.cwd)
            || typeof binding.sessionId !== "string" || !binding.sessionId || binding.sessionId.length > 512
            || Array.from(binding.sessionId).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
            || (binding.engine !== undefined && (typeof binding.engine !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(binding.engine)))) {
            throw new Error("Invalid agent session metadata.");
        }
        const matches = (await provider.list()).filter((item) => item.boardName === binding.boardName);
        if (matches.length !== 1) return { reason: matches.length ? "Multiple providers match the saved board name." : "The saved provider is unavailable." };
        if (!(await fs.stat(binding.cwd)).isDirectory) return { reason: "The saved agent workspace is unavailable." };
        return { binding: binding as AgentSessionBinding, provider: matches[0] };
    }
    public save(boardName: string, engine: string | undefined, cwd: string, started: AgentSessionStarted): Promise<void> {
        const binding: AgentSessionBinding = { boardName, ...(engine !== undefined ? { engine } : {}), cwd, sessionId: started.sessionId };
        return this.enqueue(async () => { await fs.write(await this.metadataPath(), JSON.stringify(binding, null, 2)); });
    }
    public clear(): Promise<void> {
        return this.enqueue(async () => {
            const path = await this.metadataPath();
            if (await fs.exists(path)) {
                await fs.delete(path);
                if (await fs.exists(path)) throw new Error("Unable to clear agent session metadata.");
            }
        });
    }
    private enqueue(action: () => Promise<void>): Promise<void> {
        const result = this.writes.then(action);
        this.writes = result.catch((): undefined => undefined);
        return result;
    }
    private async metadataPath(): Promise<string> { return fpJoin(await fs.dataFileName("agent-session"), "session.json"); }
}
