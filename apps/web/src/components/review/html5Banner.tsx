// Reloops OSS: cloud's HTML5 banner viewer isn't included; banners fall back to the unsupported-preview card.
import { createOssUnsupportedViewer } from "./oss/OssUnsupportedViewer";

export default createOssUnsupportedViewer("HTML5 banner", "bannerUrl");
