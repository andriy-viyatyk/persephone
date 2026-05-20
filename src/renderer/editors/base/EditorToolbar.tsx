import React from "react";
import { Panel } from "../../uikit/Panel";

export interface EditorToolbarProps {
    name?: string;
    borderTop?: boolean;
    borderBottom?: boolean;
    children?: React.ReactNode;
}

export function EditorToolbar({
    name,
    borderTop,
    borderBottom,
    children,
}: EditorToolbarProps) {
    return (
        <Panel
            name={name ?? "editor-toolbar"}
            direction="row"
            align="center"
            gap="sm"
            overflow="hidden"
            background="dark"
            paddingX="sm"
            paddingY="xs"
            shrink={false}
            borderTop={borderTop}
            borderBottom={borderBottom}
            hideWhenEmpty
        >
            {children}
        </Panel>
    );
}

