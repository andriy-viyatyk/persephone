import { TOneState } from "../../core/state/state";
import { errMessage } from "../../../shared/utils";

export interface IPageRestoreState {
    status: "ready" | "loading" | "error";
    error?: string;
}

export class PageRestore {
    readonly state = new TOneState<IPageRestoreState>({ status: "ready" });
    ready: Promise<void> = Promise.resolve();
    retry?: () => Promise<void>;

    private controller: AbortController | undefined;
    private attempt = 0;
    private readonly afterReadyHooks = new Set<() => void>();

    start(restore: (signal: AbortSignal) => Promise<void>): Promise<void> {
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        const attempt = ++this.attempt;
        this.state.update((state) => {
            state.status = "loading";
            state.error = undefined;
        });

        const restorePromise = Promise.resolve().then(() => restore(controller.signal));
        const cancellationPromise = new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => {
                const error = new Error("Page restore was cancelled.");
                error.name = "AbortError";
                reject(error);
            }, { once: true });
        });
        const ready = Promise.race([restorePromise, cancellationPromise]).then(() => {
            if (attempt !== this.attempt) return;
            this.controller = undefined;
            this.state.update((state) => {
                state.status = "ready";
                state.error = undefined;
            });
            for (const hook of this.afterReadyHooks) {
                try {
                    hook();
                } catch {
                    // A post-restore hint must not change a successful restore into a failure.
                }
            }
        }, (error: unknown) => {
            if (attempt === this.attempt) {
                this.controller = undefined;
                this.state.update((state) => {
                    state.status = "error";
                    state.error = errMessage(error, "Failed to restore page content.");
                });
            }
            throw error;
        });

        // UI-only opens do not await this promise; callers awaiting `ready` still see rejection.
        void ready.catch((): void => {});
        this.ready = ready;
        return ready;
    }

    cancel(): void {
        this.attempt++;
        this.controller?.abort();
        this.controller = undefined;
    }

    get isRestoring(): boolean {
        return this.state.get().status === "loading";
    }

    afterReady(hook: () => void): void {
        this.afterReadyHooks.add(hook);
    }
}
