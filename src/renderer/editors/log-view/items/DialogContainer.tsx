import { ReactNode } from "react";
import { Panel } from "../../../uikit";

// =============================================================================
// Component
// =============================================================================

interface DialogContainerProps {
    resolved: boolean;
    children: ReactNode;
}

export function DialogContainer({ resolved, children }: DialogContainerProps) {
    return (
        <Panel
            name="log-dialog-container"
            direction="column"
            border
            borderColor={resolved ? "default" : "active"}
            rounded="md"
            overflow="hidden"
            width="fit-content"
            maxWidth="100%"
        >
            {children}
        </Panel>
    );
}
