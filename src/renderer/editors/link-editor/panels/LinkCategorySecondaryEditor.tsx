import { createPortal } from "react-dom";
import type { SecondaryEditorProps } from "../../../ui/navigation/secondary-editor-registry";
import type { TextFileModel } from "../../text/TextEditorModel";
import { useContentViewModel } from "../../base/useContentViewModel";
import type { LinkViewModel } from "../LinkViewModel";
import { LinkCategoryPanel } from "./LinkCategoryPanel";

export default function LinkCategorySecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    const vm = useContentViewModel<LinkViewModel>(model as TextFileModel, "link-view");
    const isMainEditor = model.page?.mainEditor === model;

    if (!vm) return null;

    return (
        <>
            {headerRef && createPortal(<>{isMainEditor ? "Categories" : "Links"}</>, headerRef)}
            <LinkCategoryPanel vm={vm} useOpenRawLink={!isMainEditor} categoriesOnly={isMainEditor} pageId={isMainEditor ? undefined : model.page?.id} />
        </>
    );
}
