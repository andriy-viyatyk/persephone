import styled from "@emotion/styled";
import { useSyncExternalStore } from "react";
import { TagsList } from "../../../components/basic/TagsList";
import type { LinkViewModel } from "../LinkViewModel";

// =============================================================================
// Styles
// =============================================================================

const LinkTagsPanelRoot = styled.div({
    flex: 1,
    display: "flex",
    overflow: "hidden",
    width: "100%",
});

// =============================================================================
// Component
// =============================================================================

interface LinkTagsPanelProps {
    vm: LinkViewModel;
}

export function LinkTagsPanel({ vm }: LinkTagsPanelProps) {
    const pageState = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get(),
    );

    return (
        <LinkTagsPanelRoot>
            <TagsList
                tags={pageState.tags}
                value={pageState.selectedTag}
                onChange={vm.setSelectedTag}
                getCount={vm.getTagCount}
            />
        </LinkTagsPanelRoot>
    );
}
