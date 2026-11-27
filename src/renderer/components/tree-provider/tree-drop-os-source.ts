import type { ILink, ITreeProvider } from "../../api/types/io.tree";
import { fpDirname, fpNormalizeForCompare } from "../../core/utils/file-path";
import { createTreeProvider } from "../../content/tree-providers/tree-provider-factory";
import { isWindows } from "../../../shared/platform";
import { t } from "../../../shared/i18n/t";

export interface OsTreeDropSource {
    provider: ITreeProvider;
    item?: ILink;
}

/** Create a short-lived local tree adapter and resolve an OS path to a provider-owned link. */
export function osTreeDropRoot(filePath: string): string {
    if (!isWindows) return "/";
    const drive = /^([A-Za-z]:)[\\/]/.exec(filePath);
    if (drive) return `${drive[1]}\\`;
    const networkShare = /^(\\\\[^\\/]+[\\/][^\\/]+)/.exec(filePath);
    if (networkShare) return `${networkShare[1]}\\`;
    throw new Error(t("dialogs.treeTransferInvalidOsPath"));
}

export function createOsTreeDropProvider(rootPath: string): ITreeProvider {
    return createTreeProvider({ type: "file", rootPath });
}

export async function resolveOsTreeDropItem(provider: ITreeProvider, filePath: string): Promise<ILink | undefined> {
    const parent = fpDirname(filePath);
    const items = await provider.list(parent);
    return items.find((candidate) => fpNormalizeForCompare(candidate.href) === fpNormalizeForCompare(filePath));
}
