import type { IContentPipe } from "../api/types/io.pipe";

/** Derive the response MIME from the logical pipe's display/source name. */
export function contentTypeForPipe(pipe: IContentPipe): string {
    const archiveTransformer = pipe.transformers.find((transformer) => transformer.type === "archive");
    const entryPath = archiveTransformer?.config.entryPath;
    const name = typeof entryPath === "string" ? entryPath : pipe.displayName || pipe.provider.sourceUrl;
    const extension = name.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase();
    switch (extension) {
        case "aac": return "audio/aac";
        case "flac": return "audio/flac";
        case "m4a": return "audio/mp4";
        case "mp3": return "audio/mpeg";
        case "oga":
        case "ogg": return "audio/ogg";
        case "opus": return "audio/opus";
        case "wav": return "audio/wav";
        case "avi": return "video/x-msvideo";
        case "mkv": return "video/x-matroska";
        case "mov": return "video/quicktime";
        case "mp4": return "video/mp4";
        case "m3u8": return "application/vnd.apple.mpegurl";
        case "ts": return "video/mp2t";
        case "webm": return "video/webm";
        case "ogv": return "video/ogg";
        case "avif": return "image/avif";
        case "gif": return "image/gif";
        case "ico": return "image/x-icon";
        case "jpeg":
        case "jpg": return "image/jpeg";
        case "png": return "image/png";
        case "svg": return "image/svg+xml";
        case "webp": return "image/webp";
        case "pdf": return "application/pdf";
        case "md":
        case "markdown": return "text/markdown";
        case "txt": return "text/plain";
        case "json": return "application/json";
        case "html":
        case "htm": return "text/html";
        case "csv": return "text/csv";
        case "xml": return "application/xml";
        case "yaml":
        case "yml": return "application/yaml";
        case "zip": return "application/zip";
        case "7z": return "application/x-7z-compressed";
        case "tar": return "application/x-tar";
        case "gz":
        case "gzip": return "application/gzip";
        case "doc": return "application/msword";
        case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        case "xls": return "application/vnd.ms-excel";
        case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        case "ppt": return "application/vnd.ms-powerpoint";
        case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        default: return "application/octet-stream";
    }
}
