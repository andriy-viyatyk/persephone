import type { LinkCollectionViewProps } from "./LinksItemsView";
import type { LinkViewMode } from "./linkTypes";

export interface LinksTilesProps extends LinkCollectionViewProps {
    viewMode: Exclude<LinkViewMode, "list">;
}
