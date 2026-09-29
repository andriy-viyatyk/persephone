import type { IPipeStage } from "../../api/types/io.pipe";
import { formatBytes } from "../../core/utils/format-bytes";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import "./PipeStageListView.css";

export interface PipeStageListViewProps {
    stages: ReadonlyArray<IPipeStage>;
    density: "compact" | "expanded";
}

export class PipeStageListView extends VanillaView<PipeStageListViewProps> {
    public constructor(props: PipeStageListViewProps) {
        super(props, document.createElement("div"));
        this.root.dataset.type = "pipe-stage-list";
        this.root.dataset.name = "pipe-stage-list";
    }

    protected onMount(): void {
        this.render();
    }

    protected onUpdate(props: PipeStageListViewProps): void {
        this.render(props);
    }

    private render(props = this.props): void {
        this.root.dataset.density = props.density;
        const fragment = document.createDocumentFragment();
        for (const stage of props.stages) {
            const row = document.createElement("div");
            row.dataset.type = "pipe-stage";
            row.dataset.name = "pipe-stage";
            row.dataset.part = "stage";
            row.dataset.role = stage.role;
            row.dataset.status = stage.status?.state ?? "idle";

            const heading = document.createElement("div");
            heading.dataset.part = "heading";
            const name = document.createElement("span");
            name.dataset.part = "display-name";
            name.textContent = stage.displayName;
            const role = document.createElement("span");
            role.dataset.part = "role";
            role.textContent = stage.role;
            heading.append(name, role);
            row.append(heading);

            const status = stage.status;
            if (status?.text) row.append(this.createLine("text", status.text));
            if (status?.detail) row.append(this.createLine("detail", status.detail));
            if (status?.progress) {
                const loaded = this.createLine("progress", `Loaded ${formatBytes(status.progress.loaded)}`);
                if (status.progress.total != null && Number.isFinite(status.progress.total)) {
                    loaded.append(document.createTextNode(` of ${formatBytes(status.progress.total)}`));
                }
                row.append(loaded);
            }
            if (status?.rate != null && Number.isFinite(status.rate)) {
                row.append(this.createLine("rate", `${formatBytes(status.rate)}/s`));
            }
            fragment.append(row);
        }
        this.root.replaceChildren(fragment);
    }

    private createLine(part: string, text: string): HTMLDivElement {
        const line = document.createElement("div");
        line.dataset.part = part;
        line.textContent = text;
        return line;
    }
}
