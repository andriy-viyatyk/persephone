import React from "react";
import { Panel } from "../../uikit/Panel";
import { Text } from "../../uikit/Text";

export interface EditorErrorProps {
    children?: React.ReactNode;
}

export function EditorError({ children }: EditorErrorProps) {
    return (
        <Panel
            name="editor-error"
            flex
            justify="center"
            align="center"
            padding="xxl"
        >
            <Text color="warning" preWrap>
                {children}
            </Text>
        </Panel>
    );
}
