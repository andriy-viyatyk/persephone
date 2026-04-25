import React from "react";

// --- Types ---

export interface SpacerProps {
    /** Fixed size in px. When omitted, Spacer fills all available flex space. */
    size?: number | string;
}

// --- Component ---

export function Spacer({ size }: SpacerProps) {
    if (size !== undefined) {
        return (
            <span
                data-type="spacer"
                style={{ flexBasis: size, flexGrow: 0, flexShrink: 0 }}
            />
        );
    }
    return (
        <span
            data-type="spacer"
            style={{ flex: "1 1 auto" }}
        />
    );
}
