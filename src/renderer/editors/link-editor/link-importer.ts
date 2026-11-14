import { app } from "../../api/app";
import { fpJoin } from "../../core/utils/file-path";
import type { ILink } from "../../api/types/io.tree";
import type { LinkItem } from "./linkTypes";

export interface LinkImportResult {
    links: Partial<LinkItem>[];
    limitReached: boolean;
}

export class LinkImporter {
    async prepare(
        items: ILink[],
        existingLinks: LinkItem[],
        moveExistingToCategory?: string,
        onExistingMoved?: (link: LinkItem, category: string) => void,
        limit = 100,
    ): Promise<LinkImportResult> {
        const existingHrefs = new Set(existingLinks.map((link) => link.href.toLowerCase()));
        const directLinks: Partial<LinkItem>[] = [];
        const foldersToScan: ILink[] = [];

        for (const item of items) {
            if (item.isDirectory) {
                foldersToScan.push(item);
            } else {
                if (existingHrefs.has(item.href.toLowerCase())) {
                    if (moveExistingToCategory !== undefined) {
                        const existing = existingLinks.find(
                            (link) => link.href.toLowerCase() === item.href.toLowerCase(),
                        );
                        if (existing && existing.category !== moveExistingToCategory) {
                            onExistingMoved?.(existing, moveExistingToCategory);
                        }
                    }
                    continue;
                }
                existingHrefs.add(item.href.toLowerCase());
                directLinks.push({
                    title: item.title,
                    href: item.href,
                    category: item.category || "",
                    tags: item.tags?.length ? item.tags : undefined,
                    imgSrc: item.imgSrc,
                });
            }
        }

        const scanned = foldersToScan.length
            ? await this.scanFolders(foldersToScan, existingHrefs, limit)
            : { links: [], limitReached: false };
        return {
            links: [...directLinks, ...scanned.links],
            limitReached: scanned.limitReached,
        };
    }

    private async scanFolders(
        folders: ILink[],
        existingHrefs: Set<string>,
        limit: number,
    ): Promise<LinkImportResult> {
        const links: Partial<LinkItem>[] = [];
        const queue = [...folders];

        while (queue.length > 0) {
            const folder = queue.shift();
            let entries: { name: string; isDirectory: boolean }[];
            try {
                entries = await app.fs.listDirWithTypes(folder.href);
            } catch {
                continue;
            }

            for (const entry of entries) {
                const fullPath = fpJoin(folder.href, entry.name);
                if (entry.isDirectory) {
                    queue.push({
                        title: entry.name,
                        href: fullPath,
                        category: folder.category || "",
                        tags: [],
                        isDirectory: true,
                    });
                    continue;
                }
                if (existingHrefs.has(fullPath.toLowerCase())) continue;
                existingHrefs.add(fullPath.toLowerCase());
                links.push({
                    title: entry.name,
                    href: fullPath,
                    category: folder.category || "",
                });
                if (limit > 0 && links.length >= limit) {
                    return { links, limitReached: true };
                }
            }
        }

        return { links, limitReached: false };
    }
}
