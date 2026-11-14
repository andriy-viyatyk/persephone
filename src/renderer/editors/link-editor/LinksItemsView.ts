import type { ILink } from "../../api/types/io.tree";
import type { IconName } from "../../theme/icon-registry";
import type { GridModelCapability } from "../../uikit/DataGrid";
import type { ImageRoute } from "./routed-src";
import { LinksListView } from "./LinksListView";
import type { LinksListProps } from "./LinksList";
import { LinksTilesView } from "./LinksTilesView";
import type { LinksTilesProps } from "./LinksTiles";
import type { LinkViewMode } from "./linkTypes";

export interface LinkCollectionViewProps {
    links: ILink[];
    selectedId?: string;
    selectedIds?: ReadonlySet<string>;
    getId?: (link: ILink) => string;
    onSelect?: (link: ILink, event?: MouseEvent) => void;
    onEdit?: (link: ILink) => void;
    onDelete?: (link: ILink, skipConfirm: boolean) => void;
    onDoubleClick?: (link: ILink) => void;
    onContextMenu?: (event: MouseEvent, link: ILink) => void;
    getAdditionalIcon?: (link: ILink) => IconName | undefined;
    dragSourceId?: string;
    onDragStartOverride?: (link: ILink, event: DragEvent) => boolean;
    imageProxy?: ImageRoute | null;
    onGridModel?: (model: GridModelCapability | null) => void;
    onItemDragEnter?: (link: ILink, event: DragEvent) => void;
    onItemDragOver?: (link: ILink, event: DragEvent) => void;
    onItemDragLeave?: (link: ILink, event: DragEvent) => void;
    onItemDrop?: (link: ILink, event: DragEvent) => void;
    dropTargetId?: string | null;
}

export function createLinksItemsView(mode: "list", props: LinksListProps): LinksListView;
export function createLinksItemsView(
    mode: Exclude<LinkViewMode, "list">,
    props: LinksTilesProps,
): LinksTilesView;
export function createLinksItemsView(
    mode: LinkViewMode,
    props: LinksListProps | LinksTilesProps,
): LinksListView | LinksTilesView {
    if (mode === "list" && !("viewMode" in props)) return new LinksListView(props);
    if (mode !== "list" && "viewMode" in props) return new LinksTilesView(props);
    throw new Error("Link item view mode and props do not match.");
}
