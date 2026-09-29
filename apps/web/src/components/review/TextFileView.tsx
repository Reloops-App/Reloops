// Reloops OSS: cloud's syntax-highlighted text preview (shiki) isn't included; text files fall back to the
// unsupported-preview card.
import { createOssUnsupportedViewer } from "./oss/OssUnsupportedViewer";

export default createOssUnsupportedViewer("Text", "url");
