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

export const appServiceDescriptors = [
    {
        key: "settings",
        load: async (): Promise<IApp["settings"]> => (await import("./settings")).settings,
        initialize: undefined as undefined,
    },
    {
        key: "editors",
        load: async (): Promise<IApp["editors"]> => (await import("./editors")).editors,
        initialize: undefined as undefined,
    },
    {
        key: "recent",
        load: async (): Promise<IApp["recent"]> => (await import("./recent")).recent,
        initialize: undefined as undefined,
    },
    {
        key: "fs",
        load: async (): Promise<IApp["fs"]> => (await import("./fs")).fs,
        initialize: undefined as undefined,
    },
    {
        key: "window",
        load: async (): Promise<Window> => (await import("./window")).appWindow,
        initialize: undefined as undefined,
    },
    {
        key: "shell",
        load: async (): Promise<IApp["shell"]> => (await import("./shell")).shell,
        initialize: undefined as undefined,
    },
    {
        key: "ui",
        load: async (): Promise<IApp["ui"]> => (await import("./ui")).ui,
        initialize: undefined as undefined,
    },
    {
        key: "downloads",
        load: async (): Promise<IApp["downloads"]> => (await import("./downloads")).downloads,
        initialize: (downloads: IApp["downloads"]): Promise<void> => downloads.init(),
    },
    {
        key: "menuFolders",
        load: async (): Promise<IApp["menuFolders"]> => (await import("./menu-folders")).menuFolders,
        initialize: undefined as undefined,
    },
    {
        key: "proc",
        load: async (): Promise<IApp["proc"]> => (await import("./proc")).proc,
        initialize: undefined as undefined,
    },
    {
        key: "boards",
        load: async (): Promise<IApp["boards"]> => (await import("./boards")).boards,
        initialize: undefined as undefined,
    },
    {
        key: "boardVars",
        load: async (): Promise<IApp["boardVars"]> => (await import("./board-vars/admin-api")).boardVarsAdmin,
        initialize: undefined as undefined,
    },
    {
        key: "capabilities",
        load: async (): Promise<IApp["capabilities"]> => (await import("./capabilities")).capabilities,
        initialize: undefined as undefined,
    },
] as const satisfies readonly AppServiceDescriptorUnion[];

type RegisteredAppServiceKey = (typeof appServiceDescriptors)[number]["key"];
type AssertNever<T extends never> = T;
type _AllAppServicesRegistered = AssertNever<Exclude<AppServiceKey, RegisteredAppServiceKey>>;

export type AppServiceSurface = {
    [TDescriptor in (typeof appServiceDescriptors)[number] as TDescriptor["key"]]: Awaited<
        ReturnType<TDescriptor["load"]>
    >;
};
