import styled from "@emotion/styled";
import { useSyncExternalStore } from "react";
import { TagsList } from "../../../components/basic/TagsList";
import type { LinkViewModel } from "../LinkViewModel";

// =============================================================================
// Styles
// =============================================================================

const LinkHostnamesPanelRoot = styled.div({
    flex: 1,
    display: "flex",
    overflow: "hidden",
    width: "100%",
});

// =============================================================================
// Component
// =============================================================================

interface LinkHostnamesPanelProps {
    vm: LinkViewModel;
}

export function LinkHostnamesPanel({ vm }: LinkHostnamesPanelProps) {
    const pageState = useSyncExternalStore(
        (cb) => vm.state.subscribe(cb),
        () => vm.state.get(),
    );

    return (
        <LinkHostnamesPanelRoot>
            <TagsList
                tags={pageState.hostnames}
                value={pageState.selectedHostname}
                onChange={vm.setSelectedHostname}
                getCount={vm.getHostnameCount}
                separator={"\0"}
                rootLabel="All"
            />
        </LinkHostnamesPanelRoot>
    );
}
