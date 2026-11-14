import { DragEnterCounter } from "./drag-enter-counter";

/** Tracks nested drag targets and the single pending hover callback owned by a drag surface. */
export class DropTargetTracker<TTarget> {
    private readonly dragEnterCounter = new DragEnterCounter<TTarget>();
    private hoverTimer: number | null = null;
    private disposed = false;

    enter(target: TTarget): boolean {
        if (this.disposed) return false;
        return this.dragEnterCounter.enter(target);
    }

    leave(target: TTarget): boolean {
        if (this.disposed) return false;
        return this.dragEnterCounter.leave(target);
    }

    scheduleHover(target: TTarget, delayMs: number, callback: (target: TTarget) => void): void {
        if (this.disposed) return;
        this.cancelHover();
        this.hoverTimer = window.setTimeout(() => {
            this.hoverTimer = null;
            if (!this.disposed) callback(target);
        }, delayMs);
    }

    cancelHover(): void {
        if (this.hoverTimer !== null) window.clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
    }

    clear(): void {
        this.dragEnterCounter.clear();
        this.cancelHover();
    }

    dispose(): void {
        if (this.disposed) return;
        this.clear();
        this.disposed = true;
    }
}
