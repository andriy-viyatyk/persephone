import styled from "@emotion/styled";
import { clsx } from "clsx";
import { useEffect, useRef } from "react";
import { TextFileModel } from "./TextPageModel";
import { PageToolbar } from "../base/EditorToolbar";
import { TextToolbar } from "./TextToolbar";
import { ScriptPanel } from "./ScriptPanel";
import { TextFooter } from "./TextFooter";
import color from "../../theme/color";
import { ActiveEditor } from "./ActiveEditor";
import { FlexSpace } from "../../components/layout/Elements";
import { pagesModel } from "../../api/pages";
import { PageModel } from "../base";

const TextPageViewRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    height: 200,
    rowGap: 2,
    position: "relative",
    outline: "none",
    "& .editor-overlay": {
        position: "absolute",
        inset: 0,
        zIndex: 5,
        backgroundColor: color.background.default,
        display: "flex",
        flexDirection: "column",
        "&:empty": {
            display: "none",
        },
    },
    "& .footer-bar": {
        paddingRight: 8,
        "& .footer-label": {
            padding: "0 8px 0 0",
            color: color.text.light,
            "&::before": {
                content: '"|"',
                marginRight: 8,
                color: color.border.default,
            },
        },
        "& .hide-empty": {
            "&:empty": {
                display: "none",
            },
        },
    },
});

interface TextPageViewProps {
    model: TextFileModel;
}

export function TextPageView({ model }: TextPageViewProps) {
    const { restored } = model.state.use((s) => ({
        restored: s.restored,
    }));
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const subscription = pagesModel.onFocus.subscribe((pageModel) => {
            if (pageModel !== (model as PageModel)) return;
            setTimeout(() => {
                const root = rootRef.current;
                if (root && !root.contains(document.activeElement)) {
                    root.focus();
                }
            }, 200);
        });
        return () => subscription.unsubscribe();
    }, [model]);

    return (
        <TextPageViewRoot
            ref={rootRef}
            className={clsx("file-page")}
            onKeyDown={model.handleKeyDown}
            tabIndex={0}
        >
            <PageToolbar borderBottom>
                <TextToolbar
                    model={model}
                    setEditorToolbarRefLast={model.setEditorToolbarRefLast}
                    setEditorToolbarRefFirst={model.setEditorToolbarRefFirst}
                />
            </PageToolbar>
            {restored ? <ActiveEditor model={model} /> : <FlexSpace />}
            <ScriptPanel model={model} />
            <PageToolbar borderTop className="footer-bar">
                <TextFooter model={model} />
            </PageToolbar>
            <div
                ref={model.setEditorOverlayRef}
                className="editor-overlay"
            />
        </TextPageViewRoot>
    );
}

// Re-export with old name for backward compatibility
export { TextPageView as TextFilePage };
