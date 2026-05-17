import { useSyncExternalStore } from "react";
import { CategoryList, Panel } from "../../../uikit";
import type { LinkViewModel } from "../LinkViewModel";

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
        <Panel
            name="link-hostnames-panel"
            direction="row"
            flex={1}
            overflow="hidden"
            width="100%"
        >
            <CategoryList
                name="link-hostnames"
                items={pageState.hostnames}
                value={pageState.selectedHostname}
                onChange={vm.setSelectedHostname}
                getCount={vm.getHostnameCount}
                separator={"\0"}
                rootLabel="All"
            />
        </Panel>
    );
}
