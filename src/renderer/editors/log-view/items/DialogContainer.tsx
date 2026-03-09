import styled from "@emotion/styled";
import { ReactNode } from "react";
import color from "../../../theme/color";

// =============================================================================
// Styled Components
// =============================================================================

const ContainerRoot = styled.div({
    border: "1px solid",
    borderRadius: 4,
    margin: "2px 0",
    overflow: "hidden",

    "&.active": {
        borderColor: color.border.active,
    },
    "&.resolved": {
        borderColor: color.border.default,
    },
});

// =============================================================================
// Component
// =============================================================================

interface DialogContainerProps {
    resolved: boolean;
    children: ReactNode;
}

export function DialogContainer({ resolved, children }: DialogContainerProps) {
    return (
        <ContainerRoot className={resolved ? "resolved" : "active"}>
            {children}
        </ContainerRoot>
    );
}
