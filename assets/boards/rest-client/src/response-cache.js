import { byteLength } from "./response-utils.js";

const CACHE_KEY = "response-cache";
const MAX_CACHE_BYTES = 9 * 1024 * 1024;

export class ResponseCache {
    #timer;
    #memory = new Map();
    #persisted = new Map();

    constructor(bridge) { this.bridge = bridge; }

    async load() {
        try {
            const value = await this.bridge.pageState.get(CACHE_KEY);
            if (!value) return;
            const parsed = JSON.parse(value);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
            for (const [id, entry] of Object.entries(parsed)) {
                if (!entry || typeof entry !== "object" || !entry.response || entry.response.isBinary) continue;
                this.#memory.set(id, entry); this.#persisted.set(id, entry);
            }
            const previousSize = byteLength(JSON.stringify(Object.fromEntries(this.#persisted)));
            this.#trim();
            if (byteLength(JSON.stringify(Object.fromEntries(this.#persisted))) !== previousSize) this.schedule();
        } catch (error) {
            this.bridge.notify(error?.message || "Unable to restore response cache.", "warning");
        }
    }

    get(id) { return this.#memory.get(id); }
    entries() { return [...this.#memory.entries()]; }

    set(id, entry) {
        this.#memory.delete(id); this.#memory.set(id, entry);
        if (entry.response?.isBinary) { this.#persisted.delete(id); this.schedule(); return; }
        this.#persisted.delete(id); this.#persisted.set(id, entry);
        this.#trim(); this.schedule();
    }

    delete(id) { this.#memory.delete(id); this.#persisted.delete(id); this.schedule(); }

    #trim() {
        const serialized = () => JSON.stringify(Object.fromEntries(this.#persisted));
        while (this.#persisted.size && byteLength(serialized()) > MAX_CACHE_BYTES) {
            const oldest = this.#persisted.keys().next().value;
            this.#persisted.delete(oldest);
        }
    }

    schedule() {
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => { void this.flush(); }, 500);
    }

    async flush() {
        clearTimeout(this.#timer); this.#timer = undefined;
        try {
            if (!this.#persisted.size) await this.bridge.pageState.remove(CACHE_KEY);
            else await this.bridge.pageState.set(CACHE_KEY, JSON.stringify(Object.fromEntries(this.#persisted)));
        } catch (error) {
            this.bridge.notify(error?.message || "Unable to save response cache.", "warning");
        }
    }

    dispose() { clearTimeout(this.#timer); void this.flush(); }
}
