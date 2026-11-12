// Keep this first so the shared cascade layer order is established before any component stylesheet.
import "./renderer/theme/style-layers.css";
import "./renderer/i18n/startup";
import { loadMonacoNls } from "./renderer/i18n/monaco-nls";
import "./renderer/theme/root.css";
import { customThemeCatalog } from "./renderer/theme/custom-theme-catalog";
import { installThemeAtStartup } from "./renderer/theme/themes";

async function bootstrap(): Promise<(container: HTMLElement) => () => void> {
    const nlsReady = loadMonacoNls();
    if (nlsReady) await nlsReady;

    installThemeAtStartup(customThemeCatalog.loadSync().map((entry) => entry.theme));

    // Imported only after Monaco's messages are in place: these modules can pull in Monaco.
    const [{ app }, { api }] = await Promise.all([
        import("./renderer/api/app"),
        import("./ipc/renderer/api"),
        import("./renderer/api/settings"),
    ]);
    const rendererIndex = import("./renderer/index");
    await app.startup(rendererIndex);
    const cont = await rendererIndex;

    setTimeout(() => api.windowReady(), 0);
    return cont.mount;
}

async function startRenderer(): Promise<void> {
    const mount = await bootstrap();
    const root = document.getElementById("root");
    if (root) mount(root);
}

void startRenderer();
