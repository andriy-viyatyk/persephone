import type { LinkViewModel } from "../../editors/link-editor/LinkViewModel";
import type { LinkItem } from "../../editors/link-editor/linkTypes";

/**
 * Safe facade around LinkViewModel for script access.
 * Implements the ILinkEditor interface from api/types/link-editor.d.ts.
 *
 * - Links are read-only snapshots (ILink projection of LinkItem)
 * - `href` is exposed as `url`, `pinned` is computed from state
 * - Delete operations skip confirmation dialogs
 */
export class LinkEditorFacade {
    constructor(private readonly vm: LinkViewModel) {}

    get links(): Array<{ readonly id: string; readonly url: string; readonly title: string; readonly category: string; readonly tags: readonly string[]; readonly pinned: boolean; readonly isCategory: boolean }> {
        return this.vm.state.get().data.links.map((link) => mapLink(link, this.vm));
    }

    get categories(): string[] {
        return this.vm.state.get().categories;
    }

    get tags(): string[] {
        return this.vm.state.get().tags;
    }

    get linksCount(): number {
        return this.vm.state.get().data.links.length;
    }

    addLink(url: string, title?: string, category?: string): void {
        this.vm.addLink({ href: url, title: title ?? "", category: category ?? "" });
    }

    deleteLink(id: string): void {
        this.vm.deleteLink(id, true);
    }

    updateLink(id: string, data: { title?: string; category?: string; url?: string }): void {
        const updates: Partial<Omit<LinkItem, "id">> = {};
        if (data.title !== undefined) updates.title = data.title;
        if (data.category !== undefined) updates.category = data.category;
        if (data.url !== undefined) updates.href = data.url;
        this.vm.updateLink(id, updates);
    }

}

/** Map internal LinkItem → ILink. */
function mapLink(link: LinkItem, vm: LinkViewModel) {
    return {
        id: link.id,
        url: link.href,
        title: link.title,
        category: link.category,
        tags: link.tags,
        pinned: vm.isLinkPinned(link.id),
        isCategory: link.isCategory ?? false,
    };
}
