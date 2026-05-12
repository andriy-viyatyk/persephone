import React from "react";

// --- Types ---

export interface SpacerProps {
    /** Optional debug label emitted as `data-name` on the root element. Use to disambiguate
     *  multiple instances of this primitive in DOM inspector output. Never used for styling. */
    name?: string;
    /** Fixed size in px. When omitted, Spacer fills all available flex space. */
    size?: number | string;
}

// --- Component ---

export function Spacer({ name, size }: SpacerProps) {
    if (size !== undefined) {
        return (
            <span
                data-type="spacer"
                data-name={name}
                style={{ flexBasis: size, flexGrow: 0, flexShrink: 0 }}
            />
        );
    }
    return (
        <span
            data-type="spacer"
            data-name={name}
            style={{ flex: "1 1 auto" }}
        />
    );
}
