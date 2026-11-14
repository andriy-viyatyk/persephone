import type { ILink } from "../../api/types/io.tree";
import type { LinkCollectionViewProps } from "./LinksItemsView";

export interface LinksListProps extends LinkCollectionViewProps {
    searchText?: string;
    allTags?: string[];
    onToggleTag?: (link: ILink, tag: string) => void;
}
