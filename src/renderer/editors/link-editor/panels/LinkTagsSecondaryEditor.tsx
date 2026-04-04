import { createPortal } from "react-dom";
import type { SecondaryEditorProps } from "../../../ui/navigation/secondary-editor-registry";
import type { TextFileModel } from "../../text/TextEditorModel";
import { useContentViewModel } from "../../base/useContentViewModel";
import type { LinkViewModel } from "../LinkViewModel";
import { LinkTagsPanel } from "./LinkTagsPanel";

export default function LinkTagsSecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    const vm = useContentViewModel<LinkViewModel>(model as TextFileModel, "link-view");

    if (!vm) return null;

    return (
        <>
            {headerRef && createPortal(<>Tags</>, headerRef)}
            <LinkTagsPanel vm={vm} />
        </>
    );
}
