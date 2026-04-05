import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { SecondaryEditorProps } from "../../../ui/navigation/secondary-editor-registry";
import type { TextFileModel } from "../../text/TextEditorModel";
import { useContentViewModel } from "../../base/useContentViewModel";
import type { LinkViewModel } from "../LinkViewModel";
import { LinkCategoryPanel } from "./LinkCategoryPanel";
import { TOneState } from "../../../core/state/state";
import type { NavigationState } from "../../../api/pages/PageModel";

export default function LinkCategorySecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    const vm = useContentViewModel<LinkViewModel>(model as TextFileModel, "link-view");
    const isMainEditor = model.page?.mainEditor === model;

    // Expose treeProvider and selectionState on the model (duck-typing)
    // so that CategoryEditor can find it via findTreeProviderHost().
    useEffect(() => {
        if (!vm || isMainEditor) return;
        const m = model as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        m.treeProvider = vm.treeProvider;
        if (!m.selectionState) {
            m.selectionState = new TOneState<NavigationState>({ selectedHref: null });
        }
        return () => {
            m.treeProvider = null;
        };
    }, [vm, model, isMainEditor]);

    if (!vm) return null;

    return (
        <>
            {headerRef && createPortal(<>{isMainEditor ? "Categories" : "Links"}</>, headerRef)}
            <LinkCategoryPanel vm={vm} useOpenRawLink={!isMainEditor} categoriesOnly={isMainEditor} pageId={isMainEditor ? undefined : model.page?.id} />
        </>
    );
}
