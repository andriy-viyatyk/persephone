import { createContentsElement } from "../../uikit/shared/create-contents-element";
import { t, untranslated } from "../../../shared/i18n/t";
import { TextEditorPageView } from "../base/TextEditorPageView";
import { ButtonView, type ButtonViewProps } from "../../uikit/Button/ButtonView";
import { IconButtonView, type IconButtonViewProps } from "../../uikit/IconButton/IconButtonView";
import { InputView } from "../../uikit/Input/InputView";
import type { InputProps } from "../../uikit/Input/InputView";
import { VanillaView } from "../../uikit/shared/vanilla-view";
import { showColumnsOptions } from "./components/ColumnsOptions";
import { showCsvOptions } from "./components/CsvOptions";
import { GridEditor, type GridEditorState } from "./GridEditor";
import { GridBodyView, getVisibleRowsLabel } from "./GridBodyView";
import "../../uikit/Button/Button.css";



interface GridToolbarProps {
    model: GridEditor;
}

class GridToolbarView extends VanillaView<GridToolbarProps> {
    private model: GridEditor;
    private gridAvailabilitySubscription: (() => void) | undefined;
    private columnsButton: IconButtonView | undefined;
    private csvButton: ButtonView | undefined;

    public constructor(props: GridToolbarProps) {
        super(props, createContentsElement());
        this.model = props.model;
    }

    protected onMount(): void {
        this.columnsButton = this.child(new IconButtonView(this.columnsButtonProps()));
        this.root.append(this.columnsButton.root);
        this.columnsButton.mount();
        this.bindGridAvailability();
        this.syncColumnsButton();
        this.syncCsvButton();
    }

    protected onUpdate(props: GridToolbarProps): void {
        if (this.model !== props.model) {
            this.gridAvailabilitySubscription?.();
            this.model = props.model;
            this.bindGridAvailability();
        }
        this.syncColumnsButton();
        this.syncCsvButton();
        this.csvButton?.update(this.csvButtonProps());
    }

    protected onDispose(): void {
        this.columnsButton = undefined;
        this.csvButton = undefined;
        this.gridAvailabilitySubscription?.();
        this.gridAvailabilitySubscription = undefined;
    }

    private syncCsvButton(): void {
        if (this.model.format === "csv" && !this.csvButton) {
            this.csvButton = this.child(new ButtonView(this.csvButtonProps()));
            this.root.append(this.csvButton.root);
            this.csvButton.mount();
        } else if (this.model.format !== "csv" && this.csvButton) {
            this.releaseChild(this.csvButton);
            this.csvButton = undefined;
        }
    }

    private columnsButtonProps(): IconButtonViewProps {
        return {
            name: "grid-columns",
            size: "sm",
            title: t("editors.editColumns"),
            icon: "columns",
            disabled: !this.model.gridAvailable.get(),
            onClick: this.handleColumnsClick,
        };
    }

    private bindGridAvailability(): void {
        this.gridAvailabilitySubscription = this.model.gridAvailable.subscribe(
            () => this.syncColumnsButton(),
        );
    }

    private syncColumnsButton(): void {
        this.columnsButton?.update(this.columnsButtonProps());
    }

    private csvButtonProps(): ButtonViewProps {
        return {
            name: "grid-csv-options",
            size: "sm",
            variant: "ghost",
            title: t("editors.csvOptions"),
            onClick: () => {
                const button = this.csvButton?.root;
                if (button) void showCsvOptions(button, this.model);
            },
        children: untranslated("?-csv"),
        };
    }

    private readonly handleColumnsClick = (event: MouseEvent): void => {
        const grid = this.model.grid;
        if (!grid || !(event.currentTarget instanceof Element)) return;
        void showColumnsOptions(
            event.currentTarget,
            grid,
            this.model.format === "csv",
            this.model.onUpdateRows,
            this.model.page?.id,
        );
    };
}

class GridSearchInputView extends VanillaView<{ model: GridEditor }> {
    private model: GridEditor;
    private input: InputView | undefined;
    private clearButton: IconButtonView | undefined;
    private stateSubscription: (() => void) | undefined;

    public constructor(props: { model: GridEditor }) {
        super(props, createContentsElement());
        this.model = props.model;
    }

    protected onMount(): void {
        this.input = this.child(new InputView(this.inputProps(this.model.state.get().search)));
        this.root.append(this.input.root);
        this.input.mount();
        this.bindState();
        this.sync(this.model.state.get().search);
        this.own(() => {
            this.stateSubscription?.();
            this.stateSubscription = undefined;
        });
    }

    protected onUpdate(props: { model: GridEditor }): void {
        if (props.model !== this.model) {
            this.model = props.model;
            this.bindState();
        }
        this.sync(this.model.state.get().search);
    }

    protected onDispose(): void {
        this.input = undefined;
        this.clearButton = undefined;
    }

    private bindState(): void {
        this.stateSubscription?.();
        this.stateSubscription = this.model.state.subscribe<string>(
            (search) => this.sync(search),
            (state) => state.search,
        );
    }

    private sync(search: string): void {
        if (search && !this.clearButton) {
            this.clearButton = this.child(new IconButtonView(this.clearButtonProps()));
            this.root.append(this.clearButton.root);
            this.clearButton.mount();
        } else if (!search && this.clearButton) {
            this.releaseChild(this.clearButton);
            this.clearButton = undefined;
        }
        this.input?.update(this.inputProps(search));
    }

    private inputProps(search: string): InputProps {
        return {
            name: "grid-search",
            size: "sm",
            width: 200,
            value: search,
            onChange: this.model.setSearch,
            placeholder: t("menus.searchPlaceholder"),
            endSlot: this.clearButton?.root,
        };
    }

    private clearButtonProps(): IconButtonViewProps {
        return {
            name: "grid-search-clear",
            size: "sm",
            title: t("menus.clearSearch"),
            icon: "close",
            onClick: this.model.clearSearch,
        };
    }
}

interface GridFooterProjection {
    rowCount: GridEditorState["rowCount"];
    filterCount: number;
    displayedRowCount: GridEditorState["displayedRowCount"];
}

function selectGridFooter(state: GridEditorState): GridFooterProjection {
    return {
        rowCount: state.rowCount,
        filterCount: state.filters.length,
        displayedRowCount: state.displayedRowCount,
    };
}

export class GridEditorView extends VanillaView<{ model: GridEditor }> {
    private model: GridEditor | undefined;
    private body: GridBodyView | undefined;
    private toolbar: GridToolbarView | undefined;
    private searchInput: GridSearchInputView | undefined;
    private pageView: TextEditorPageView<GridEditor> | undefined;
    private footer: HTMLSpanElement | undefined;

    public constructor(props: { model: GridEditor }) {
        super(props, createContentsElement());
    }

    protected onMount(): void {
        const model = this.props.model;
        this.model = model;
        const body = this.child(new GridBodyView({ model }));
        const toolbar = this.child(new GridToolbarView({ model }));
        const searchInput = this.child(new GridSearchInputView({ model }));
        const footer = document.createElement("span");
        footer.className = "records-count";
        const pageView = this.child(new TextEditorPageView({
            model: this.props.model,
            createParts: () => ({ body: body.root, toolbar: toolbar.root, rightToolbar: searchInput.root, footer }),
        }));

        this.body = body;
        this.toolbar = toolbar;
        this.searchInput = searchInput;
        this.pageView = pageView;
        this.footer = footer;
        this.root.append(body.root, toolbar.root, searchInput.root, footer, pageView.root);
        body.mount();
        toolbar.mount();
        searchInput.mount();
        pageView.mount();
        this.bind(this.model.state, selectGridFooter, (projection) => {
            this.updateFooter(projection);
        });
    }

    protected onUpdate(props: { model: GridEditor }): void {
        const model = props.model;
        const body = this.body;
        const toolbar = this.toolbar;
        const searchInput = this.searchInput;
        const pageView = this.pageView;
        if (!body || !toolbar || !searchInput || !pageView) return;
        pageView.update({ model, createParts: () => ({ body: body.root, toolbar: toolbar.root, rightToolbar: searchInput.root, footer: this.footer }) });
        body.update({ model });
        toolbar.update({ model });
        this.updateFooter(selectGridFooter(model.state.get()));
    }

    protected onDispose(): void {
        this.model = undefined;
        this.body = undefined;
        this.toolbar = undefined;
        this.searchInput = undefined;
        this.pageView = undefined;
        this.footer = undefined;
    }

    private updateFooter(projection: GridFooterProjection): void {
        if (!this.footer || !this.model) return;
        void projection;
        this.footer.textContent = getVisibleRowsLabel(this.model);
    }
}
