import React, { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import type { SecondaryEditorProps } from "../../../ui/navigation/secondary-editor-registry";
import type { TextFileModel } from "../../text/TextEditorModel";
import { useContentViewModel } from "../../base/useContentViewModel";
import type { LinkViewModel } from "../LinkViewModel";
import { LinkCategoryPanel } from "./LinkCategoryPanel";
import { TOneState, useOptionalState } from "../../../core/state/state";
import type { NavigationState } from "../../../api/pages/PageModel";
import { Button } from "../../../components/basic/Button";
import { SwapIcon } from "../../../theme/icons";

export default function LinkCategorySecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    const vm = useContentViewModel<LinkViewModel>(model as TextFileModel, "link-view");
    // Subscribe to mainEditorId so we re-render on promote/demote toggle
    const mainEditorId = useOptionalState(model.page?.state, (s) => s.mainEditorId, null);
    const isMainEditor = mainEditorId === model.id;

    const handleToggleMainEditor = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        model.page?.promoteSecondaryToMain(model);
    }, [model]);

    // Expose treeProvider, selectionState, and selectByHref on the model (duck-typing)
    // so that CategoryEditor can find it via findTreeProviderHost()
    // and VideoEditorModel can update link selection on track navigation.
    useEffect(() => {
        if (!vm || isMainEditor) return;
        const m = model as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        m.treeProvider = vm.treeProvider;
        if (!m.selectionState) {
            m.selectionState = new TOneState<NavigationState>({ selectedHref: null });
        }
        m.selectByHref = (href: string) => {
            const link = vm.state.get().data.links.find((l) => l.href === href);
            if (link?.id) vm.selectLink(link.id);
        };
        return () => {
            m.treeProvider = null;
            m.selectByHref = null;
        };
    }, [vm, model, isMainEditor]);

    if (!vm) return null;

    const headerContent = (
        <>
            {isMainEditor ? "Categories" : "Links"}
            <span className="panel-spacer" />
            <Button type="icon" size="small"
                title={isMainEditor ? "Demote to sidebar only" : "Open as main editor"}
                onClick={handleToggleMainEditor}
            >
                <SwapIcon width={14} height={14} />
            </Button>
        </>
    );

    return (
        <>
            {headerRef && createPortal(headerContent, headerRef)}
            <LinkCategoryPanel vm={vm} useOpenRawLink={!isMainEditor} categoriesOnly={isMainEditor} pageId={isMainEditor ? undefined : model.page?.id} />
        </>
    );
}
