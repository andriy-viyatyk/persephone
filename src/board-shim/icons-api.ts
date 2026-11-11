import type { HostFrameChannel } from "./board-host-frame-channel";

const FILE_ICONS_BATCH = 500;

export function createIconsApi(deps: { hostFrame: HostFrameChannel }) {
    const { hostFrame } = deps;
    const fileIconCache = new Map<string, string>();
    let fileIconCacheGeneration = 0;

    function fileIconsRpc(names: string[]): Promise<{ urls: string[]; icons: Record<string, number> }> {
        return hostFrame.request("fileIcons", { names });
    }
    async function iconsForFiles(names: unknown): Promise<Record<string, string>> {
        if (!Array.isArray(names)) throw new TypeError("persephone.icons.forFiles() expects an array of file names.");
        const wanted = [...new Set(names.filter((name): name is string => typeof name === "string" && name !== ""))];
        const found = new Map<string, string>();
        const missing: string[] = [];
        for (const name of wanted) {
            const url = fileIconCache.get(name);
            if (url) found.set(name, url);
            else missing.push(name);
        }
        for (let start = 0; start < missing.length; start += FILE_ICONS_BATCH) {
            const generation = fileIconCacheGeneration;
            const reply = await fileIconsRpc(missing.slice(start, start + FILE_ICONS_BATCH));
            const cacheable = generation === fileIconCacheGeneration;
            for (const [name, index] of Object.entries(reply.icons)) {
                const url = reply.urls[index];
                if (typeof url !== "string") continue;
                found.set(name, url);
                if (cacheable) fileIconCache.set(name, url);
            }
        }
        const result: Record<string, string> = {};
        for (const [name, url] of found) result[name] = url;
        return result;
    }
    function invalidate(): void {
        fileIconCache.clear();
        fileIconCacheGeneration++;
    }
    return { api: { icons: { forFiles: iconsForFiles } }, invalidate };
}
