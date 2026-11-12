import { api } from "../../ipc/renderer/api";
import { AppEvents } from "./events/AppEvents";
import { createLinkData } from "../../shared/link-data";
import { t } from "../../shared/i18n/t";
import type { IFetchOptions } from "./types/app";
import type { LaunchInput } from "../../shared/launch-input";
import { errMessage } from "../../shared/utils";
import {
    appServiceDescriptors,
    type AppServiceKey,
    type AppServiceSurface,
} from "./app-service-registry";
import { runAppStartupPhase, type AppStartupContext } from "./app-startup";
import type { PagesModel } from "./pages/PagesModel";
import type { ILinkData } from "./types/io.link-data";

// Note: IApp (.d.ts) is the script-facing interface for Monaco IntelliSense.
// App class has additional internal methods and rich internal types.
class App {
    private _version = "";
    private _initialized = false;
    private _setupInitialized = false;
    private _servicesInitialization: Promise<void> | undefined;
    private _pagesInitialized = false;
    private _eventsInitialized = false;
    private _rendererEventsService?: { openLaunchInput(input: LaunchInput): Promise<void> };
    private readonly _serviceValues: Partial<
        Record<AppServiceKey, AppServiceSurface[AppServiceKey]>
    > = {};
    private readonly _serviceFailures = new Map<
        AppServiceKey,
        { phase: "load" | "initialize"; error: unknown }
    >();
    private _pages: PagesModel | undefined;
    private _events = new AppEvents();

    constructor() {
        for (const { key } of appServiceDescriptors) {
            Object.defineProperty(this, key, {
                get: () => this._serviceValues[key],
            });
        }
    }

    get version(): string {
        return this._version;
    }

    get pages(): PagesModel {
        if (!this._pages) {
            throw new Error("Pages are not initialized");
        }
        return this._pages;
    }

    get events(): AppEvents {
        return this._events;
    }

    fetch = async (url: string, options?: IFetchOptions): Promise<Response> => {
        const { nodeFetch } = await import("./node-fetch");
        return nodeFetch(url, options);
    };

    openRawLink = async (href: string, options?: { editor?: string }): Promise<void> => {
        await this._events.openRawLink.sendAsync(
            createLinkData(href, { sourceId: "app-api", target: options?.editor }),
        );
    };

    async init(): Promise<void> {
        if (this._initialized) return;
        this._initialized = true;
        this._version = await api.getAppVersion();
    }

    async initSetup(): Promise<void> {
        if (this._setupInitialized) return;
        this._setupInitialized = true;
        const { initMonaco } = await import("./setup/configure-monaco");
        await initMonaco();
    }

    /** Run the internal startup table from the composition root after locale and theme setup. */
    async startup(rendererIndex: Promise<unknown>): Promise<void> {
        const context = this._startupContext(rendererIndex);
        await runAppStartupPhase("bootstrap", context);
        await this.initServices();
        await this.initPages();
        await this.initEvents();
        await runAppStartupPhase("deferred", context);
        await runAppStartupPhase("before-mount", context);
    }

    async initServices(): Promise<void> {
        if (!this._servicesInitialization) {
            this._servicesInitialization = runAppStartupPhase("services", this._startupContext(Promise.resolve()));
        }
        await this._servicesInitialization;
    }

    private async _loadServices(): Promise<void> {
        for (const descriptor of appServiceDescriptors) {
            let value: AppServiceSurface[AppServiceKey];
            try {
                value = await descriptor.load();
            } catch (error) {
                this._serviceFailures.set(descriptor.key, { phase: "load", error });
                continue;
            }

            this._serviceValues[descriptor.key] = value;
            if (!descriptor.initialize) continue;
            try {
                await descriptor.initialize(value as never);
            } catch (error) {
                this._serviceFailures.set(descriptor.key, { phase: "initialize", error });
            }
        }
    }

    private _reportServiceFailures(): void {
        for (const { key } of appServiceDescriptors) {
            const failure = this._serviceFailures.get(key);
            if (failure) {
                console.error(
                    `[App] Service "${key}" failed to ${failure.phase}: ${errMessage(failure.error)}`,
                    failure.error,
                );
            } else if (this._serviceValues[key] === undefined) {
                console.error(`[App] Service "${key}" is missing after initialization`);
            }
        }
    }

    private _reportBackgroundFailure(name: string, error: unknown): void {
        console.error(`[App] Startup entry "${name}" failed: ${errMessage(error)}`, error);
    }

    async initPages(): Promise<void> {
        if (this._pagesInitialized) return;
        this._pagesInitialized = true;
        await runAppStartupPhase("before-pages", this._startupContext(Promise.resolve()));
    }

    async initEvents(): Promise<void> {
        if (this._eventsInitialized) return;
        this._eventsInitialized = true;
        await runAppStartupPhase("events", this._startupContext(Promise.resolve()));
    }

    private _startupContext(rendererIndex: Promise<unknown>): AppStartupContext {
        return {
            rendererIndex,
            init: () => this.init(),
            initSetup: () => this.initSetup(),
            loadAppServices: () => this._loadServices(),
            reportServiceFailures: () => this._reportServiceFailures(),
            reportBackgroundFailure: (name, error) => this._reportBackgroundFailure(name, error),
            setPages: (pages) => { this._pages = pages; },
            getPages: () => this.pages,
            setRendererEventsService: (service) => { this._rendererEventsService = service; },
            openStartupInput: (input) => {
                if (!this._rendererEventsService) {
                    throw new Error("Renderer events service is not initialized");
                }
                return this._rendererEventsService.openLaunchInput(input);
            },
            checkEmptyPage: () => this.pages.checkEmptyPage(),
            notifyMnemeExited: (error) => {
                const services = this as unknown as AppServiceSurface;
                services.ui.notify(t("api.mnemeExited", { error }), "error");
            },
            openRawLink: async (link: ILinkData) => {
                await this._events.openRawLink.sendAsync(link);
            },
        };
    }
}

/**
 * The root application object.
 * Available in scripts as the global `app` variable.
 */
export const app = new App() as App & AppServiceSurface;
