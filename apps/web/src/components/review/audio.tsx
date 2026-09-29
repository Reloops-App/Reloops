// Reloops OSS: cloud's audio viewer isn't included; audio falls back to the unsupported-preview card.
import { createOssUnsupportedViewer } from "./oss/OssUnsupportedViewer";

export default createOssUnsupportedViewer("Audio", "audioUrl");
