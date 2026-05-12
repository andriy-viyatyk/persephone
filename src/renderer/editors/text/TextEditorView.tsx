import { useEffect, useRef } from "react";
import { TextFileModel } from "./TextEditorModel";
import { PageToolbar } from "../base/EditorToolbar";
import { TextToolbar } from "./TextToolbar";
import { ScriptPanel } from "./ScriptPanel";
import { TextFooter } from "./TextFooter";
import { ActiveEditor } from "./ActiveEditor";
import { Panel } from "../../uikit/Panel/Panel";
import { Spacer } from "../../uikit/Spacer/Spacer";
import { pagesModel } from "../../api/pages";

interface TextEditorViewProps {
    model: TextFileModel;
}

export function TextEditorView({ model }: TextEditorViewProps) {
    const { restored } = model.state.use((s) => ({
        restored: s.restored,
    }));
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const subscription = pagesModel.onFocus.subscribe((pageModel) => {
            if (pageModel !== model.page) return;
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
        <Panel
            name="text-editor-root"
            ref={rootRef}
            direction="column"
            flex={1}
            height={0}
            position="relative"
            gap="xs"
            tabIndex={0}
            onKeyDown={model.handleKeyDown}
        >
            <PageToolbar borderBottom>
                <TextToolbar
                    model={model}
                    setEditorToolbarRefLast={model.setEditorToolbarRefLast}
                    setEditorToolbarRefFirst={model.setEditorToolbarRefFirst}
                />
            </PageToolbar>
            {restored ? <ActiveEditor model={model} /> : <Spacer />}
            <ScriptPanel model={model} />
            <PageToolbar borderTop>
                <TextFooter model={model} />
            </PageToolbar>
            <div ref={model.setEditorOverlayRef} className="editor-overlay" />
        </Panel>
    );
}
