// Keep this first so the shared cascade layer order is established before any component stylesheet.
import "./renderer/theme/style-layers.css";
import "./renderer/i18n/startup";
import { loadMonacoNls } from "./renderer/i18n/monaco-nls";
import "./renderer/theme/root.css";

async function bootstrap(): Promise<(container: HTMLElement) => () => void> {
    const nlsReady = loadMonacoNls();
    if (nlsReady) await nlsReady;

    // Imported only after Monaco's messages are in place: these modules can pull in Monaco.
    const [{ app }, { api }, { settings }] = await Promise.all([
        import("./renderer/api/app"),
        import("./ipc/renderer/api"),
        import("./renderer/api/settings"),
    ]);
    const [cont] = await Promise.all([
        import("./renderer/index"),
        app.init(),
        app.initSetup(),
    ]);
    await app.initServices();
    await settings.wait();
    const { initBoardTrustSync } = await import("./renderer/api/board-trust-sync");
    await initBoardTrustSync();
    const { customEditorRegistry } = await import("./renderer/editors/board/custom-editor-registry");
    await customEditorRegistry.ensureInitialized();
    await app.initPages();
    await app.initEvents();
    await app.openStartupInputs();
    setTimeout(() => api.windowReady(), 0);
    return cont.mount;
}

async function startRenderer(): Promise<void> {
    const mount = await bootstrap();
    const container = document.getElementById("root");
    if (container) mount(container);
}

void startRenderer();
