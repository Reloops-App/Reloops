// Reloops OSS: cloud's live URL review isn't included (OSS captures web pages as screenshots instead).
import { createOssUnsupportedViewer } from "./oss/OssUnsupportedViewer";

export default createOssUnsupportedViewer("Live website", "url");
