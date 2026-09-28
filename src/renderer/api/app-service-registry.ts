import type { IApp } from "./types/app";
import type { Window } from "./window";

type NonServiceAppKey =
    | "version"
    | "pages"
    | "events"
    | "call"
    | "fetch"
    | "openRawLink"
    | "runAsync";

export type AppServiceKey = Exclude<keyof IApp, NonServiceAppKey>;

export interface AppServiceDescriptor<TKey extends AppServiceKey, TValue> {
    readonly key: TKey;
    readonly load: () => Promise<TValue>;
    readonly initialize?: (value: TValue) => Promise<void> | void;
}

type AppServiceDescriptorUnion = {
    [TKey in AppServiceKey]: AppServiceDescriptor<TKey, IApp[TKey]>;
}[AppServiceKey];

function defineService<const TKey extends AppServiceKey, TValue extends IApp[TKey]>(
    descriptor: AppServiceDescriptor<TKey, TValue>,
): AppServiceDescriptor<TKey, TValue> {
    return descriptor;
}

export const appServiceDescriptors = [
    defineService({
        key: "settings",
        load: async (): Promise<IApp["settings"]> => (await import("./settings")).settings,
    }),
    defineService({
        key: "editors",
        load: async (): Promise<IApp["editors"]> => (await import("./editors")).editors,
    }),
    defineService({
        key: "recent",
        load: async (): Promise<IApp["recent"]> => (await import("./recent")).recent,
    }),
    defineService({
        key: "fs",
        load: async (): Promise<IApp["fs"]> => (await import("./fs")).fs,
    }),
    defineService({
        key: "window",
        load: async (): Promise<Window> => (await import("./window")).appWindow,
    }),
    defineService({
        key: "shell",
        load: async (): Promise<IApp["shell"]> => (await import("./shell")).shell,
    }),
    defineService({
        key: "ui",
        load: async (): Promise<IApp["ui"]> => (await import("./ui")).ui,
    }),
    defineService({
        key: "downloads",
        load: async (): Promise<IApp["downloads"]> => (await import("./downloads")).downloads,
        initialize: (downloads: IApp["downloads"]): Promise<void> => downloads.init(),
    }),
    defineService({
        key: "menuFolders",
        load: async (): Promise<IApp["menuFolders"]> => (await import("./menu-folders")).menuFolders,
    }),
    defineService({
        key: "proc",
        load: async (): Promise<IApp["proc"]> => (await import("./proc")).proc,
    }),
    defineService({
        key: "boards",
        load: async (): Promise<IApp["boards"]> => (await import("./boards")).boards,
    }),
    defineService({
        key: "boardVars",
        load: async (): Promise<IApp["boardVars"]> => (await import("./board-vars/admin-api")).boardVarsAdmin,
    }),
    defineService({
        key: "capabilities",
        load: async (): Promise<IApp["capabilities"]> => (await import("./capabilities")).capabilities,
        initialize: async (): Promise<void> => {
            const [{ registerCapabilityTransport }, { boardCapabilityTransport }] = await Promise.all([
                import("./capability-bus"),
                import("./board-capability-transport"),
            ]);
            registerCapabilityTransport(boardCapabilityTransport);
        },
    }),
] as const satisfies readonly AppServiceDescriptorUnion[];

type RegisteredAppServiceKey = (typeof appServiceDescriptors)[number]["key"];
type AssertNever<T extends never> = T;
type _AllAppServicesRegistered = AssertNever<Exclude<AppServiceKey, RegisteredAppServiceKey>>;

export type AppServiceSurface = {
    [TDescriptor in (typeof appServiceDescriptors)[number] as TDescriptor["key"]]: Awaited<
        ReturnType<TDescriptor["load"]>
    >;
};
