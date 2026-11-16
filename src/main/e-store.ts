import Store from "electron-store";

/** Narrowed surface — electron-store's TS surface uses schema generics; we
 *  only need a string-keyed get/set bag. */
interface StoreSurface {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
}

class ElectronStore {
    private store?: StoreSurface;

    /** Created on first use: `new Store()` fixes its folder from `userData` at construction, and
     *  this module is imported before `main.ts` applies `--profile`, so an eager instance would put
     *  every named profile's data in the default profile's `config.json`. */
    private get instance(): StoreSurface {
        this.store ??= new Store() as unknown as StoreSurface;
        return this.store;
    }

    public get<T>(key: string, defaultValue?: T): T | undefined {
        return (this.instance.get(key) as T | undefined) ?? defaultValue;
    }

    public set(key: string, value: unknown): void {
        this.instance.set(key, value);
    }
}

export const electronStore = new ElectronStore();
