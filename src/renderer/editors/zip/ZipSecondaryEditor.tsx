import { useCallback } from "react";
import { TreeProviderView } from "../../components/tree-provider";
import { app } from "../../api/app";
import { RawLinkEvent } from "../../api/events/events";
import type { ITreeProviderItem } from "../../api/types/io.tree";
import type { SecondaryEditorProps } from "../../ui/navigation/secondary-editor-registry";
import type { ZipEditorModel } from "./ZipEditorModel";

export default function ZipSecondaryEditor({ model }: SecondaryEditorProps) {
    const zipModel = model as ZipEditorModel;
    const provider = zipModel.treeProvider;

    const handleItemClick = useCallback((item: ITreeProviderItem) => {
        const url = provider?.getNavigationUrl(item) ?? item.href;
        const ownerPageId = zipModel.ownerPage?.id;
        app.events.openRawLink.sendAsync(new RawLinkEvent(
            url, undefined, { pageId: ownerPageId, sourceId: zipModel.id },
        ));
    }, [provider, zipModel]);

    if (!provider) return null;

    return (
        <TreeProviderView
            provider={provider}
            onItemClick={handleItemClick}
            onItemDoubleClick={handleItemClick}
        />
    );
}
