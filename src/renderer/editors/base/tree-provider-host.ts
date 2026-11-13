import type { ITreeProvider } from "../../api/types/io.tree";
import { TOneState } from "../../core/state/state";
import { TraitKey } from "../../core/traits/traits";
import type { NavigationState } from "./navigation-state";

export interface TreeProviderRevealSignal {
    version: number;
    requestedHref: string;
}

export interface ITreeProviderHost {
    readonly provider: ITreeProvider | null;
    readonly providerState: TOneState<ITreeProvider | null>;
    readonly selectionState: TOneState<NavigationState>;
    readonly revealSignal: TOneState<TreeProviderRevealSignal>;
    setProvider(provider: ITreeProvider | null): void;
    setSelected(href: string | null): void;
    requestReveal(href: string): void;
}

export const TREE_PROVIDER_HOST_TRAIT = new TraitKey<ITreeProviderHost>("tree-provider-host");

export interface TreeProviderHostOptions<P extends ITreeProvider> {
    createProvider?: () => P | null;
}

/** Owns the tree provider, navigation selection, and reveal requests for an editor. */
export class TreeProviderHost<P extends ITreeProvider> implements ITreeProviderHost {
    readonly providerState = new TOneState<P | null>(null);
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });
    readonly revealSignal = new TOneState<TreeProviderRevealSignal>({ version: 0, requestedHref: "" });

    private currentProvider: P | null = null;
    private disposed = false;

    constructor(private readonly options: TreeProviderHostOptions<P> = {}) {}

    get provider(): P | null {
        if (!this.currentProvider && !this.disposed && this.options.createProvider) {
            const provider = this.options.createProvider();
            if (provider) this.setProvider(provider);
        }
        return this.currentProvider;
    }

    setProvider(provider: P | null): void {
        this.currentProvider = provider;
        this.providerState.set(provider);
    }

    reset(): void {
        this.setProvider(null);
    }

    setSelected(href: string | null): void {
        this.selectionState.update((state) => { state.selectedHref = href; });
    }

    requestReveal(href: string): void {
        this.setSelected(href);
        this.revealSignal.update((state) => {
            state.version++;
            state.requestedHref = href;
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.reset();
    }
}

export interface TreeRevealControllerOptions {
    getSelectedHref: () => string | null;
    scheduleFrame: (callback: () => void) => () => void;
    reveal: (href: string) => void;
}

/** Schedules the latest host reveal against a mounted tree on its owner's frame scheduler. */
export class TreeRevealController {
    private frameCleanup: (() => void) | undefined;
    private readonly unsubscribe: () => void;
    private disposed = false;

    constructor(
        private readonly signal: TOneState<TreeProviderRevealSignal>,
        private readonly options: TreeRevealControllerOptions,
    ) {
        this.apply(this.signal.get());
        this.unsubscribe = this.signal.subscribe(() => this.apply(this.signal.get()));
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe();
        this.cancelFrame();
    }

    private readonly apply = (signal: TreeProviderRevealSignal): void => {
        this.cancelFrame();
        const selectedHref = this.options.getSelectedHref();
        if (signal.version <= 0 || !selectedHref) return;
        this.frameCleanup = this.options.scheduleFrame(() => {
            this.frameCleanup = undefined;
            this.options.reveal(selectedHref);
        });
    };

    private cancelFrame(): void {
        this.frameCleanup?.();
        this.frameCleanup = undefined;
    }
}
