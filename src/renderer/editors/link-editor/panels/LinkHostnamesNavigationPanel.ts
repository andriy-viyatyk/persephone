import { CategoryListView } from "../../../uikit/CategoryList/CategoryListView";
import type { CategoryListProps } from "../../../uikit/CategoryList/CategoryListView";
import type { LinkFilterNavigationStrategy } from "../LinkFilterNavigationPanelView";
import { t } from "../../../../shared/i18n/t";

function categoryProps(editor: Parameters<LinkFilterNavigationStrategy["topView"]>[0]): CategoryListProps {
    const state = editor.state.get();
    return {
        name: "link-hostnames",
        items: state.hostnames,
        value: state.selectedHostname,
        onChange: editor.setSelectedHostname,
        getCount: editor.getHostnameCount,
        separator: "\0",
        rootLabel: t("links.all"),
    };
}

export const linkHostnamesNavigationStrategy: LinkFilterNavigationStrategy = {
    name: "hostnames",
    topView(editor) {
        let categoryList: CategoryListView | undefined;
        return {
            create() {
                categoryList = new CategoryListView(categoryProps(editor));
                return {
                    root: categoryList.root,
                    mount: () => categoryList?.mount(),
                    dispose: () => categoryList?.dispose(),
                };
            },
            update() {
                categoryList?.update(categoryProps(editor));
            },
        };
    },
    selectedKey: (state) => state.selectedHostname,
    itemsFor: (editor, key) => (key
        ? editor.treeProvider?.getHostnameItems(key) ?? []
        : editor.state.get().data.links).filter((item) => !item.isDirectory),
    sourceId: "link-hostname",
};
