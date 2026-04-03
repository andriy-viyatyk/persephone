import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TreeProviderView } from "../../components/tree-provider";
import type { TreeProviderViewRef } from "../../components/tree-provider";
import { app } from "../../api/app";
import { RawLinkEvent } from "../../api/events/events";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { SecondaryEditorProps } from "../../ui/navigation/secondary-editor-registry";
import type { ZipEditorModel } from "./ZipEditorModel";
import { Button } from "../../components/basic/Button";
import { CloseIcon } from "../../theme/icons";

export default function ZipSecondaryEditor({ model, headerRef }: SecondaryEditorProps) {
    const zipModel = model as ZipEditorModel;
    const provider = zipModel.treeProvider;
    const treeProviderRef = useRef<TreeProviderViewRef>(null);

    const { selectedHref } = zipModel.selectionState.use();
    const { version: revealVersion } = zipModel.revealVersion.use();

    useEffect(() => {
        if (revealVersion > 0 && selectedHref) {
            requestAnimationFrame(() => {
                treeProviderRef.current?.revealItem(selectedHref);
            });
        }
    }, [revealVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleItemClick = useCallback((item: ITreeProviderItem) => {
        zipModel.selectionState.update((s) => { s.selectedHref = item.href; });
        const url = provider?.getNavigationUrl(item) ?? item.href;
        const pageId = zipModel.page?.id;
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            url, undefined, { pageId, sourceId: zipModel.id },
        ));
    }, [provider, zipModel]);

    const isActivePagePanel = zipModel === zipModel.page?.mainEditor;

    const headerContent = (
        <>
            Archive
            <span className="panel-spacer" />
            {!isActivePagePanel && (
                <Button type="icon" size="small" title="Close"
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        zipModel.page?.removeSecondaryEditor(zipModel);
                    }}
                >
                    <CloseIcon width={14} height={14} />
                </Button>
            )}
        </>
    );

    if (!provider) return null;

    return (
        <>
            {headerRef && createPortal(headerContent, headerRef)}
            <TreeProviderView
                ref={treeProviderRef}
                provider={provider}
                selectedHref={selectedHref ?? undefined}
                onItemClick={handleItemClick}
                onItemDoubleClick={handleItemClick}
            />
        </>
    );
}
