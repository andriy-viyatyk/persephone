import type { BoardBootContext, BoardThemePalette } from "../ipc/board-bridge/boot";
import type { MainPortChannel } from "./main-port-channel";
import { Listeners } from "./primitives";
import type { ThemeDefinition, ThemeDraft, ContrastReport, CustomThemeFile, CustomThemeBase } from "../renderer/api/types/themes";

type BoardThemes = {
    list(): Promise<ThemeDefinition[]>;
    get(id: string): Promise<ThemeDefinition | null>;
    current(): Promise<ThemeDefinition>;
    derive(base: CustomThemeBase, isDark?: boolean | null): Promise<ThemeDefinition>;
    contrast(input: ThemeDefinition | CustomThemeFile | ThemeDraft): Promise<ContrastReport>;
    fork(id: string): Promise<ThemeDraft>;
    file(id: string): Promise<CustomThemeFile | null>;
    save(draft: ThemeDraft): Promise<CustomThemeFile>;
    rename(id: string, name: string): Promise<CustomThemeFile>;
    delete(id: string): Promise<void>;
    apply(id: string): Promise<void>;
    preview(draft: ThemeDraft): Promise<ThemeDefinition>;
    endPreview(): Promise<void>;
};

function cloneBoardJson<T>(value: T): T {
    const seen = new Set<object>();
    const validate = (item: unknown): void => {
        if (item === null || typeof item === "string" || typeof item === "boolean") return;
        if (typeof item === "number" && Number.isFinite(item)) return;
        if (typeof item !== "object" || seen.has(item)) throw new Error("persephone.themes accepts JSON values only.");
        seen.add(item);
        if (Array.isArray(item)) {
            for (let index = 0; index < item.length; index++) {
                if (!Object.prototype.hasOwnProperty.call(item, index)) throw new Error("persephone.themes accepts JSON arrays only.");
                validate(item[index]);
            }
            if (Reflect.ownKeys(item).some((key) => key !== "length" && (typeof key !== "string" || !/^\d+$/.test(key)))) throw new Error("persephone.themes accepts JSON arrays only.");
        } else {
            const prototype = Object.getPrototypeOf(item);
            if (prototype !== Object.prototype && prototype !== null) throw new Error("persephone.themes accepts plain JSON objects only.");
            for (const key of Reflect.ownKeys(item)) {
                if (typeof key !== "string") throw new Error("persephone.themes accepts plain JSON objects only.");
                const descriptor = Object.getOwnPropertyDescriptor(item, key);
                if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("persephone.themes accepts plain JSON objects only.");
                validate(descriptor.value);
            }
        }
        seen.delete(item);
    };
    validate(value);
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("persephone.themes accepts JSON values only.");
    return JSON.parse(encoded) as T;
}

export function createThemesApi(deps: { mainPort: MainPortChannel; boot: BoardBootContext; invalidateIcons: () => void }) {
    const { mainPort, boot, invalidateIcons } = deps;
    const prefix = "--p-graph-";
    const withGraphPalette = (palette: BoardThemePalette): BoardThemePalette => {
        const graph: Record<string, string> = {};
        for (const [name, value] of Object.entries(palette.vars || {})) {
            if (!name.startsWith(prefix)) continue;
            graph[name.slice(prefix.length).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value;
        }
        return { ...palette, graph };
    };
    let currentTheme = withGraphPalette(boot.theme);
    const tokens: Record<string, string> = boot.tokens;
    const themeListeners = new Listeners<[BoardThemePalette]>("persephone.onThemeChange callback error:", { replay: () => [currentTheme] });
    function boardThemeCall<T>(method: string, args: unknown[] = []): Promise<T> {
        let safeArgs: unknown[];
        try { safeArgs = cloneBoardJson(args); }
        catch (error: unknown) { return Promise.reject(error); }
        return mainPort.call(`themes.${method}`, { args: safeArgs }).then((result) => cloneBoardJson(result) as T);
    }
    const themes: BoardThemes = {
        list: () => boardThemeCall("list"),
        get: (id) => boardThemeCall("get", [id]),
        current: () => boardThemeCall("current"),
        derive: (base, isDark) => boardThemeCall("derive", isDark === undefined ? [base] : [base, isDark]),
        contrast: (input) => boardThemeCall<ContrastReport>("contrast", [input]),
        fork: (id) => boardThemeCall("fork", [id]),
        file: (id) => boardThemeCall("file", [id]),
        save: (draft) => boardThemeCall("save", [draft]),
        rename: (id, name) => boardThemeCall("rename", [id, name]),
        delete: (id) => boardThemeCall("delete", [id]),
        apply: (id) => boardThemeCall("apply", [id]),
        preview: (draft) => boardThemeCall("preview", [draft]),
        endPreview: () => boardThemeCall("endPreview"),
    };
    const applyVars = (vars: Record<string, string>): void => {
        const root = document?.documentElement;
        if (!root) return;
        for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    };
    mainPort.on("theme", (payload) => {
        invalidateIcons();
        currentTheme = withGraphPalette(payload.palette);
        applyVars(currentTheme.vars);
        themeListeners.emit(currentTheme);
    });
    return {
        api: {
            themes,
            get theme(): BoardThemePalette { return currentTheme; },
            getTheme(): BoardThemePalette { return currentTheme; },
            tokens: Object.freeze({ ...tokens }),
            getTokens(): Record<string, string> { return tokens; },
            onThemeChange(callback: (theme: BoardThemePalette) => void): () => void { return themeListeners.add(callback); },
        },
    };
}
