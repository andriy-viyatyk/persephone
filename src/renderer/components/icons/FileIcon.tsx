import styled from "@emotion/styled";
import { FileTypeIcon } from "./LanguageIcon";
import { fpBasename } from "../../core/utils/file-path";

interface FileIconProps {
    path: string;
    width?: number;
    height?: number;
}

export function FileIcon(props: FileIconProps) {
    const fileName = fpBasename(props.path);
    return <FileTypeIcon fileName={fileName} width={props.width} height={props.height} />;
}

const FolderIconRoot = styled("span")({
    fontSize: 13,
    paddingBottom: 3,
});

export function FolderIcon() {
    return <FolderIconRoot>📁</FolderIconRoot>;
}
