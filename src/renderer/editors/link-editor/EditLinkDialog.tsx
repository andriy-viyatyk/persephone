import styled from "@emotion/styled";
import clsx from "clsx";
import { Dialog, DialogContent } from "../../ui/dialogs/Dialog";
import { TDialogModel } from "../../core/state/model";
import { DefaultView, ViewPropsRO, Views } from "../../core/state/view";
import { TComponentState } from "../../core/state/state";
import { showDialog } from "../../ui/dialogs/Dialogs";
import { Button } from "../../components/basic/Button";
import { TextAreaField } from "../../components/basic/TextAreaField";
import { TextField } from "../../components/basic/TextField";
import { PathInput } from "../../components/basic/PathInput";
import color from "../../theme/color";
import { CloseIcon, RenameIcon } from "../../theme/icons";
import { LinkItem } from "./linkTypes";

// =============================================================================
// Styles
// =============================================================================

const EditLinkDialogContent = styled(DialogContent)({
    minWidth: 500,
    maxWidth: 700,
    "& .form-body": {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 16px",
    },
    "& .form-row": {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    "& .form-label": {
        width: 80,
        flexShrink: 0,
        fontSize: 13,
        color: color.text.light,
        textAlign: "right",
    },
    "& .form-field": {
        flex: 1,
        minWidth: 0,
    },
    "& .tags-container": {
        flex: 1,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
        minHeight: 28,
    },
    "& .tag-chip": {
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: "2px 6px 2px 8px",
        fontSize: 12,
        borderRadius: 3,
        backgroundColor: color.background.light,
        color: color.text.default,
        border: `1px solid ${color.border.default}`,
    },
    "& .tag-remove": {
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        opacity: 0.6,
        "& svg": { width: 12, height: 12 },
        "&:hover": { opacity: 1 },
    },
    "& .tag-add-input": {
        flex: "1 1 100px",
        minWidth: 100,
    },
    "& .image-section": {
        marginLeft: 88,
    },
    "& .image-preview": {
        maxHeight: 200,
        borderRadius: 4,
        overflow: "hidden",
        backgroundColor: color.background.dark,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        "& img": {
            maxWidth: "100%",
            maxHeight: 200,
            objectFit: "contain",
        },
    },
    "& .discovered-images-label": {
        fontSize: 12,
        color: color.text.light,
        marginTop: 8,
        marginBottom: 4,
    },
    "& .discovered-images-grid": {
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
    },
    "& .discovered-image-thumb": {
        width: 60,
        height: 60,
        borderRadius: 3,
        objectFit: "cover",
        cursor: "pointer",
        border: "2px solid transparent",
        "&:hover": {
            borderColor: color.misc.blue,
        },
        "&.selected": {
            borderColor: color.misc.blue,
        },
    },
    "& .dialog-buttons": {
        display: "flex",
        flexDirection: "row",
        justifyContent: "flex-end",
        columnGap: 8,
        padding: "4px 16px 8px",
    },
    "& .dialog-button": {
        minWidth: 60,
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        padding: "4px 12px",
        "&:hover": {
            borderColor: color.border.active,
        },
    },
});

// =============================================================================
// Types
// =============================================================================

interface EditLinkDialogState {
    dialogTitle: string;
    linkTitle: string;
    href: string;
    category: string;
    tags: string[];
    imgSrc: string;
    categories: string[];
    availableTags: string[];
    discoveredImages: string[];
    newTag: string;
}

export type EditLinkResult = Omit<LinkItem, "id"> | undefined;

// =============================================================================
// Model
// =============================================================================

const editLinkDialogId = Symbol("editLinkDialog");

class EditLinkDialogModel extends TDialogModel<EditLinkDialogState, EditLinkResult> {
    handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.defaultPrevented) return;
        if (e.key === "Escape") {
            e.preventDefault();
            this.close(undefined);
        }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.save();
        }
    };

    setTitle = (value: string) => {
        this.state.update((s) => { s.linkTitle = value; });
    };

    setHref = (value: string) => {
        this.state.update((s) => { s.href = value; });
    };

    setCategory = (value: string) => {
        this.state.update((s) => { s.category = value; });
    };

    setCategoryFromBlur = (finalValue?: string) => {
        if (finalValue !== undefined) {
            this.state.update((s) => { s.category = finalValue; });
        }
    };

    setImgSrc = (value: string) => {
        this.state.update((s) => { s.imgSrc = value; });
    };

    setNewTag = (value: string) => {
        this.state.update((s) => { s.newTag = value; });
    };

    addTagFromBlur = (finalValue?: string) => {
        if (finalValue === undefined) {
            this.state.update((s) => { s.newTag = ""; });
            return;
        }
        const tagValue = finalValue.trim();
        const cleanTag = tagValue.endsWith(":") ? tagValue.slice(0, -1) : tagValue;
        if (!cleanTag) return;
        this.state.update((s) => {
            if (!s.tags.includes(cleanTag)) {
                s.tags = [...s.tags, cleanTag];
            }
            s.newTag = "";
        });
    };

    removeTag = (tag: string) => {
        this.state.update((s) => {
            s.tags = s.tags.filter((t) => t !== tag);
        });
    };

    selectDiscoveredImage = (url: string) => {
        this.state.update((s) => { s.imgSrc = url; });
    };

    save = () => {
        const state = this.state.get();
        this.close({
            title: state.linkTitle.trim(),
            href: state.href.trim(),
            category: state.category.trim(),
            tags: state.tags,
            imgSrc: state.imgSrc.trim() || undefined,
        });
    };
}

// =============================================================================
// View
// =============================================================================

function EditLinkDialog({ model }: ViewPropsRO<EditLinkDialogModel>) {
    const state = model.state.use();

    return (
        <Dialog onKeyDown={model.handleKeyDown} autoFocus={false}>
            <EditLinkDialogContent
                title={<><RenameIcon color={color.icon.default} /> {state.dialogTitle}</>}
                onClose={() => model.close(undefined)}
            >
                <div className="form-body">
                    {/* Title */}
                    <div className="form-row">
                        <span className="form-label">Title</span>
                        <TextAreaField
                            className="form-field"
                            value={state.linkTitle}
                            onChange={model.setTitle}
                            singleLine
                            placeholder="Link title..."
                            autoFocus
                        />
                    </div>

                    {/* URL */}
                    <div className="form-row">
                        <span className="form-label">URL</span>
                        <TextField
                            className="form-field"
                            value={state.href}
                            onChange={model.setHref}
                            placeholder="https://..."
                        />
                    </div>

                    {/* Category */}
                    <div className="form-row">
                        <span className="form-label">Category</span>
                        <PathInput
                            className="form-field"
                            value={state.category}
                            onChange={model.setCategory}
                            onBlur={model.setCategoryFromBlur}
                            paths={state.categories}
                            separator="/"
                            placeholder="Category path..."
                        />
                    </div>

                    {/* Tags */}
                    <div className="form-row">
                        <span className="form-label">Tags</span>
                        <div className="tags-container">
                            {state.tags.map((tag) => (
                                <span key={tag} className="tag-chip">
                                    {tag}
                                    <span className="tag-remove" onClick={() => model.removeTag(tag)}>
                                        <CloseIcon />
                                    </span>
                                </span>
                            ))}
                            <PathInput
                                className="tag-add-input"
                                value={state.newTag}
                                onChange={model.setNewTag}
                                onBlur={model.addTagFromBlur}
                                paths={state.availableTags}
                                separator=":"
                                maxDepth={1}
                                placeholder="Type + Enter to add"
                            />
                        </div>
                    </div>

                    {/* Image URL */}
                    <div className="form-row">
                        <span className="form-label">Image URL</span>
                        <TextField
                            className="form-field"
                            value={state.imgSrc}
                            onChange={model.setImgSrc}
                            placeholder="https://... (optional)"
                            endButtons={state.imgSrc ? [
                                <Button
                                    size="small"
                                    type="icon"
                                    key="clear-img"
                                    title="Clear Image URL"
                                    onClick={() => model.setImgSrc("")}
                                >
                                    <CloseIcon />
                                </Button>,
                            ] : undefined}
                        />
                    </div>

                    {/* Image Preview */}
                    {state.imgSrc && (
                        <div className="image-section">
                            <div className="image-preview">
                                <img src={state.imgSrc} alt="Preview" />
                            </div>
                        </div>
                    )}

                    {/* Discovered Images (populated by browser in US-028) */}
                    {state.discoveredImages.length > 0 && (
                        <div className="image-section">
                            <div className="discovered-images-label">Discovered Images</div>
                            <div className="discovered-images-grid">
                                {state.discoveredImages.map((url, i) => (
                                    <img
                                        key={i}
                                        src={url}
                                        alt={`Image ${i + 1}`}
                                        className={clsx("discovered-image-thumb", { selected: url === state.imgSrc })}
                                        onClick={() => model.selectDiscoveredImage(url)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Buttons */}
                <div className="dialog-buttons">
                    <Button onClick={() => model.close(undefined)} className="dialog-button">
                        Cancel
                    </Button>
                    <Button
                        onClick={model.save}
                        className="dialog-button"
                        style={{ backgroundColor: color.background.light }}
                    >
                        Save
                    </Button>
                </div>
            </EditLinkDialogContent>
        </Dialog>
    );
}

Views.registerView(editLinkDialogId, EditLinkDialog as DefaultView);

// =============================================================================
// Public API
// =============================================================================

export interface ShowEditLinkDialogOptions {
    /** Dialog title (default: "Edit Link" or "Add Link") */
    title?: string;
    /** Existing link data (for editing) or defaults (for creating) */
    link?: Partial<LinkItem>;
    /** Available categories for autocomplete */
    categories?: string[];
    /** Available tags for autocomplete */
    tags?: string[];
    /** Discovered images from browser (for future US-028 integration) */
    discoveredImages?: string[];
}

export function showEditLinkDialog(options: ShowEditLinkDialogOptions = {}): Promise<EditLinkResult> {
    const { link = {}, categories = [], tags = [], discoveredImages = [] } = options;

    const modelState: EditLinkDialogState = {
        dialogTitle: options.title || (link.id ? "Edit Link" : "Add Link"),
        linkTitle: link.title ?? "",
        href: link.href ?? "",
        category: link.category ?? "",
        tags: link.tags ? [...link.tags] : [],
        imgSrc: link.imgSrc ?? "",
        categories,
        availableTags: tags,
        discoveredImages,
        newTag: "",
    };

    const model = new EditLinkDialogModel(new TComponentState(modelState));
    return showDialog({
        viewId: editLinkDialogId,
        model,
    }) as Promise<EditLinkResult>;
}
