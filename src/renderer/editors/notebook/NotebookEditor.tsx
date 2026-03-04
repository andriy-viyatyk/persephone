import styled from "@emotion/styled";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Breadcrumb } from "../../components/basic/Breadcrumb";
import { Button } from "../../components/basic/Button";
import { TagsList } from "../../components/basic/TagsList";
import { TextField } from "../../components/basic/TextField";
import { HighlightedTextProvider } from "../../components/basic/useHighlightedText";
import { CollapsiblePanel, CollapsiblePanelStack } from "../../components/layout/CollapsiblePanelStack";
import { Splitter } from "../../components/layout/Splitter";
import { CategoryTree, CategoryTreeItem } from "../../components/TreeView";
import {
    RenderFlexCellParams,
    RenderFlexGrid,
} from "../../components/virtualization/RenderGrid/RenderFlexGrid";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { Percent } from "../../components/virtualization/RenderGrid/types";
import { splitWithSeparators } from "../../core/utils/utils";
import color from "../../theme/color";
import { CloseIcon, PlusIcon } from "../../theme/icons";
import { NotebookViewModel, defaultNotebookViewState, NotebookViewState } from "./NotebookViewModel";
import { NoteItemView } from "./NoteItemView";
import { ExpandedNoteView } from "./ExpandedNoteView";
import { NotebookEditorProps, NOTE_DRAG, CATEGORY_DRAG } from "./notebookTypes";
import { EditorError } from "../base/EditorError";
import { useContentViewModel } from "../base/useContentViewModel";

// =============================================================================
// Styles
// =============================================================================

const NotebookEditorRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "row",
    overflow: "hidden",
    "& .left-panel": {
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: color.background.dark,
        minWidth: 100,
        maxWidth: "80%",
    },
    "& .left-panel-content": {
        padding: 8,
        color: color.text.light,
        fontSize: 13,
    },
    "& .category-tree-container": {
        flex: 1,
        display: "flex",
        overflow: "hidden",
        fontSize: 13,
        paddingLeft: 4,
    },
    "& .tags-list-container": {
        flex: 1,
        display: "flex",
        overflow: "hidden",
        width: "100%",
    },
    "& .category-label-name": {
        flex: "1 1 auto",
    },
    "& .category-label-size": {
        margin: "0 4px",
        fontSize: 12,
    },
    "& .tree-cell": {
        color: color.text.light,
        "&.selected": {
            color: color.misc.blue,
        },
    },
    "& .center-panel": {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
    },
    "& .empty-state": {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 16,
        color: color.text.light,
        fontSize: 14,
    },
    "& .notes-grid": {
        flex: 1,
    },
    "& .title": {
        fontSize: 24,
        color: color.text.default,
    },
    "& .subtitle": {
        color: color.text.light,
    },
});

const SearchField = styled(TextField)({
    "& input": {
        color: color.misc.blue,
    },
});

// =============================================================================
// Component
// =============================================================================

const noopUnsubscribe = () => () => {};
const getDefaultState = () => defaultNotebookViewState;
const getColumnWidth = () => "100%" as Percent;

export function NotebookEditor({ model }: NotebookEditorProps) {
    const vm = useContentViewModel<NotebookViewModel>(model, "notebook-view");

    // Grid model ref for virtualized list updates (React rendering concern)
    const gridModelRef = useRef<RenderGridModel | null>(null);
    const setGridModel = useCallback((m: RenderGridModel | null) => {
        gridModelRef.current = m;
    }, []);

    // Always call hooks unconditionally (Rules of Hooks).
    // When vm is null (loading), subscribe to a no-op and return defaults.
    const pageState: NotebookViewState = useSyncExternalStore(
        vm ? (cb) => vm.state.subscribe(cb) : noopUnsubscribe,
        vm ? () => vm.state.get() : getDefaultState,
    );

    const allNotes = pageState.data.notes;
    const notes = pageState.filteredNotes;

    // Update virtualized grid when filteredNotes change (React rendering concern)
    useEffect(() => {
        gridModelRef.current?.update({ all: true });
    }, [notes]);

    const renderNoteCell = useCallback(
        (p: RenderFlexCellParams) => {
            const note = notes[p.row];
            if (!note || !vm) return null;
            return (
                <NoteItemView
                    key={note.id}
                    note={note}
                    notebookModel={vm}
                    categories={pageState.categories}
                    tags={pageState.tags}
                    onDelete={vm.deleteNote}
                    onExpand={vm.expandNote}
                    onAddComment={vm.addComment}
                    onCommentChange={vm.updateNoteComment}
                    onTitleChange={vm.updateNoteTitle}
                    onCategoryChange={vm.updateNoteCategory}
                    onTagAdd={vm.addNoteTag}
                    onTagRemove={vm.removeNoteTag}
                    onTagUpdate={vm.updateNoteTag}
                    cellRef={p.ref}
                />
            );
        },
        [notes, vm, pageState.categories, pageState.tags]
    );

    // Provide stored heights to RenderFlexGrid for initial row sizing
    const getInitialRowHeight = useCallback(
        (row: number) => {
            const note = notes[row];
            if (!note || !vm) return undefined;
            return vm.getNoteHeight(note.id);
        },
        [notes, vm]
    );

    // Category tree label with note count
    const getTreeItemLabel = useCallback(
        (item: CategoryTreeItem) => {
            const name = splitWithSeparators(item.category, "/\\").pop() || "";
            const size = vm?.getCategorySize(item.category);
            return (
                <>
                    <span className="category-label-name">{name || "All"}</span>
                    {size !== undefined && (
                        <span className="category-label-size">{size}</span>
                    )}
                </>
            );
        },
        [vm, pageState.categoriesSize]
    );

    if (!vm) return null;

    if (pageState.error) {
        return (
            <NotebookEditorRoot>
                <EditorError>{pageState.error}</EditorError>
            </NotebookEditorRoot>
        );
    }

    return (
        <>
            {Boolean(model.editorToolbarRefFirst) &&
                createPortal(
                    pageState.expandedPanel === "tags" ? (
                        <Breadcrumb
                            rootLabel="Tags"
                            value={pageState.selectedTag}
                            onChange={vm.setSelectedTag}
                            separators=":"
                            trailingParentSeparator
                        />
                    ) : (
                        <Breadcrumb
                            rootLabel="Categories"
                            value={pageState.selectedCategory}
                            onChange={vm.setSelectedCategory}
                        />
                    ),
                    model.editorToolbarRefFirst
                )}
            {Boolean(model.editorToolbarRefLast) &&
                createPortal(
                    <>
                        <Button
                            size="small"
                            type="raised"
                            title="Add Note"
                            onClick={vm.addNote}
                            style={{ borderColor: color.border.active }}
                        >
                            <PlusIcon /> Add Note&nbsp;
                        </Button>
                        <SearchField
                            value={pageState.searchText}
                            onChange={vm.setSearchText}
                            placeholder="Search..."
                            endButtons={
                                pageState.searchText ? [
                                    <Button
                                        key="clear"
                                        size="small"
                                        type="icon"
                                        title="Clear search"
                                        onClick={vm.clearSearch}
                                    >
                                        <CloseIcon />
                                    </Button>,
                                ] : undefined
                            }
                        />
                    </>,
                    model.editorToolbarRefLast
                )}
            <NotebookEditorRoot>
                <CollapsiblePanelStack
                    className="left-panel"
                    style={{ width: pageState.leftPanelWidth }}
                    activePanel={pageState.expandedPanel}
                    setActivePanel={vm.setExpandedPanel}
                >
                    <CollapsiblePanel id="tags" title="Tags">
                        <div className="tags-list-container">
                            <TagsList
                                tags={pageState.tags}
                                value={pageState.selectedTag}
                                onChange={vm.setSelectedTag}
                                getCount={vm.getTagSize}
                            />
                        </div>
                    </CollapsiblePanel>
                    <CollapsiblePanel id="categories" title="Categories">
                        <div className="category-tree-container">
                            <CategoryTree
                                categories={pageState.categories}
                                separators="/\"
                                rootLabel="All"
                                rootCollapsible={false}
                                onItemClick={vm.categoryItemClick}
                                getSelected={vm.getCategoryItemSelected}
                                getLabel={getTreeItemLabel}
                                refreshKey={pageState.selectedCategory}
                                dropTypes={[NOTE_DRAG, CATEGORY_DRAG]}
                                onDrop={vm.categoryDrop}
                                dragType={CATEGORY_DRAG}
                                getDragItem={vm.getCategoryDragItem}
                            />
                        </div>
                    </CollapsiblePanel>
                </CollapsiblePanelStack>
                <Splitter
                    type="vertical"
                    initialWidth={pageState.leftPanelWidth}
                    onChangeWidth={vm.setLeftPanelWidth}
                    borderSized="right"
                />
                <HighlightedTextProvider value={pageState.searchText}>
                    <div className="center-panel">
                        {allNotes.length === 0 ? (
                            <div className="empty-state">
                                <div className="title">Notes</div>
                                <div className="subtitle">No notes yet</div>
                                <div className="subtitle">
                                    Click "Add Note" to create your first note
                                </div>
                            </div>
                        ) : notes.length === 0 ? (
                            <div className="empty-state">
                                <div className="subtitle">No notes match the current filter</div>
                            </div>
                        ) : (
                            <RenderFlexGrid
                                ref={setGridModel}
                                className="notes-grid"
                                columnCount={1}
                                rowCount={notes.length}
                                columnWidth={getColumnWidth}
                                renderCell={renderNoteCell}
                                fitToWidth
                                minRowHeight={100}
                                maxRowHeight={800}
                                getInitialRowHeight={getInitialRowHeight}
                            />
                        )}
                    </div>
                </HighlightedTextProvider>
            </NotebookEditorRoot>
            {Boolean(model.editorFooterRefLast) &&
                createPortal(
                    <span>
                        {notes.length === allNotes.length
                            ? `${allNotes.length} notes`
                            : `${notes.length} of ${allNotes.length} notes`}
                    </span>,
                    model.editorFooterRefLast
                )}
            {Boolean(model.editorOverlayRef) && pageState.expandedNoteId && (() => {
                const expandedNote = allNotes.find(n => n.id === pageState.expandedNoteId);
                if (!expandedNote) return null;
                return createPortal(
                    <ExpandedNoteView
                        note={expandedNote}
                        notebookModel={vm}
                        categories={pageState.categories}
                        tags={pageState.tags}
                        onCollapse={vm.collapseNote}
                    />,
                    model.editorOverlayRef!
                );
            })()}
        </>
    );
}

const moduleExport = {
    Editor: NotebookEditor,
};

export default moduleExport;
