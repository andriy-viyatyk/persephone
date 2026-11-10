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
    const { boardRegistry } = await import("./renderer/api/boards/board-registry");
    await boardRegistry.load();
    await import("./renderer/api/editor-categories");
    const { customEditorRegistry } = await import("./renderer/api/boards/custom-editor-registry");
    await customEditorRegistry.ensureInitialized();
    await app.initPages();
    await app.initEvents();
    const { appWindow } = await import("./renderer/api/window");
    if (appWindow.boardRoot) {
        const { encodePersephoneBoardLink } = await import("./renderer/content/persephone-board-link");
        const { createLinkData } = await import("./shared/link-data");
        await app.events.openRawLink.sendAsync(createLinkData(encodePersephoneBoardLink(appWindow.boardRoot)));
        const { pagesModel } = await import("./renderer/api/pages");
        const launchedBoardPage = pagesModel.query.findPageByBoardRoot(appWindow.boardRoot);
        if (launchedBoardPage) pagesModel.layout.markLockedBoardPage(launchedBoardPage, appWindow.boardRoot);
    }
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
