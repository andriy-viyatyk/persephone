import { ReactNode } from "react";

import { TextFileModel } from "./TextEditorModel";
import { Button } from "../../uikit/Button/Button";
import { Spacer } from "../../uikit/Spacer/Spacer";
import { Divider } from "../../uikit/Divider/Divider";
import color from "../../theme/color";

const labelStyle: React.CSSProperties = {
    color: color.text.light,
    padding: "0 4px",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
};

const portalTargetStyle: React.CSSProperties = {
    ...labelStyle,
};

interface TextFooterProps {
    model: TextFileModel;
}

export function TextFooter({ model }: TextFooterProps) {
    const { open } = model.script.state.use((s) => ({
        open: s.open,
    }));
    const { encoding, editor } = model.state.use((s) => ({
        encoding: s.encoding,
        editor: s.editor,
    }));
    const actions: ReactNode[] = [];

    actions.push(
        <Button
            key="toggle-script"
            variant="ghost"
            size="sm"
            onClick={model.script.toggleOpen}
        >
            <span style={{ color: open ? color.text.default : color.text.light, fontSize: 13 }}>
                script
            </span>
        </Button>,
        <Spacer key="flex-space" />
    );

    if (editor && editor !== "monaco") {
        actions.push(
            <Divider key="editor-place-divider" orientation="vertical" />,
            <div
                key="editor-place-last"
                ref={model.setFooterRefLast}
                style={portalTargetStyle}
            />
        );
    }

    actions.push(
        <Divider key="encoding-divider" orientation="vertical" />,
        <span key="encoding-label" style={labelStyle}>
            {encoding || "utf-8"}
        </span>
    );

    return <>{actions}</>;
}
