import type { IPipeStage, IContentPipe } from "../../api/types/io.pipe";
import type { IPipeStageStatus } from "../../api/types/io.provider";
import type { PageModel } from "../../api/pages/PageModel";
import { TComponentModel } from "../../core/state/model";
import { formatBytes } from "../../core/utils/format-bytes";
import { subscribePagePipe } from "./page-pipe";
import { t } from "../../../shared/i18n/t";
import { httpStatusDisplayText } from "./http-status-text";

export interface PagePipeStatusProps {
    page: PageModel;
}

export interface PagePipeStatusState {
    pipe: IContentPipe | null;
    summary: IPipeStageStatus | undefined;
    stages: ReadonlyArray<IPipeStage>;
    visible: boolean;
    kind: "busy" | "done" | "error" | undefined;
    label: string;
    loaded?: number;
    total?: number;
    hasProgress: boolean;
    dismissed: boolean;
}

export const initialPagePipeStatusState: PagePipeStatusState = {
    pipe: null,
    summary: undefined,
    stages: [],
    visible: false,
    kind: undefined,
    label: "",
    hasProgress: false,
    dismissed: false,
};

export class PagePipeStatusModel extends TComponentModel<PagePipeStatusState, PagePipeStatusProps> {
    private releasePage: (() => void) | undefined;
    private releasePipe: (() => void) | undefined;
    private doneTimer: ReturnType<typeof setTimeout> | undefined;
    private currentPipe: IContentPipe | null = null;
    private startedAt: number | undefined;
    private observedBusy = false;
    private disposed = false;

    init(): void {
        this.releasePage = subscribePagePipe(this.props.page, (pipe) => this.bindPipe(pipe));
        this.own(() => this.releasePage?.());
    }

    override dispose(): void {
        this.disposed = true;
        this.releaseSourceSubscriptions();
        this.clearTimer();
    }

    dismissError = (): void => {
        if (this.state.get().kind !== "error") return;
        this.state.update((state) => {
            state.dismissed = true;
            state.visible = false;
        });
    };

    private bindPipe(pipe: IContentPipe | null): void {
        if (this.disposed || pipe === this.currentPipe) return;
        this.releasePipe?.();
        this.releasePipe = undefined;
        this.clearTimer();
        this.currentPipe = pipe;
        this.startedAt = undefined;
        this.observedBusy = false;
        if (!pipe) {
            this.state.set({ ...initialPagePipeStatusState });
            return;
        }
        this.releasePipe = pipe.onStatusChange(() => this.refresh());
        this.refresh();
    }

    private refresh(): void {
        const pipe = this.currentPipe;
        if (!pipe || this.disposed) return;
        const summary = pipe.summary;
        const stages = pipe.stages;
        const previous = this.state.get();
        const base: PagePipeStatusState = {
            ...initialPagePipeStatusState,
            pipe,
            summary,
            stages,
            dismissed: previous.pipe === pipe && previous.dismissed,
        };
        if (summary?.state === "connecting" || summary?.state === "active") {
            this.observedBusy = true;
            this.startedAt ??= Date.now();
            const progress = pipe.stages.find((stage) => stage.role === "provider")?.status?.progress;
            this.state.set({
                ...base,
                visible: true,
                kind: "busy",
                label: (httpStatusDisplayText(pipe.provider.type, summary) ?? summary.text) || t("menus.loading"),
                loaded: progress?.loaded,
                total: progress?.total,
                hasProgress: !!progress && Number.isFinite(progress.loaded)
                    && progress.total != null && Number.isFinite(progress.total) && progress.total > 0,
            });
            return;
        }
        if (summary?.state === "error") {
            this.clearTimer();
            this.state.set({
                ...base,
                visible: !base.dismissed,
                kind: "error",
                label: (httpStatusDisplayText(pipe.provider.type, summary) ?? summary.text) || summary.detail || t("menus.unableToLoadContent"),
            });
            return;
        }
        if (summary?.state === "done" && this.observedBusy) {
            this.clearTimer();
            const loaded = pipe.stages.find((stage) => stage.role === "provider")?.status?.progress?.loaded;
            const elapsed = this.startedAt == null ? undefined : Math.max(0, Date.now() - this.startedAt);
            const label = loaded != null && Number.isFinite(loaded) && elapsed != null
                ? this.formatLoadedDuration(formatBytes(loaded), elapsed)
                : t("menus.contentLoaded");
            this.state.set({ ...base, visible: true, kind: "done", label });
            this.doneTimer = setTimeout(() => {
                this.doneTimer = undefined;
                if (this.currentPipe === pipe && !this.disposed) {
                    this.state.update((state) => { state.visible = false; });
                }
            }, 3000);
            return;
        }
        this.clearTimer();
        this.state.set(base);
    }

    private formatLoadedDuration(size: string, milliseconds: number): string {
        const seconds = Math.round(milliseconds / 1000);
        if (seconds < 60) return t("menus.loadedInSeconds", { size, count: seconds } as never);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes < 60) return remainingSeconds
            ? t("menus.loadedInMinutesAndSeconds", { size, count: minutes, subcount: remainingSeconds } as never)
            : t("menus.loadedInMinutes", { size, count: minutes } as never);
        const hours = Math.floor(minutes / 60);
        return t("menus.loadedInHoursAndMinutes", { size, count: hours, subcount: minutes % 60 } as never);
    }

    private releaseSourceSubscriptions(): void {
        this.releasePage?.();
        this.releasePage = undefined;
        this.releasePipe?.();
        this.releasePipe = undefined;
    }

    private clearTimer(): void {
        if (this.doneTimer !== undefined) clearTimeout(this.doneTimer);
        this.doneTimer = undefined;
    }
}
