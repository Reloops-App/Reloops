import UnsupportedAssetPreview from "@/components/review/UnsupportedAssetPreview";

// Reloops OSS doesn't ship some of cloud's specialised viewers (audio, HTML5
// banners, live URL / snippet review, 360° panoramas). Those file types fall back
// to the unsupported-preview card, which still carries comments and download.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViewerProps = Record<string, any>;

export function createOssUnsupportedViewer(fileTypeLabel: string, urlProp: string) {
  return function OssUnsupportedViewer(props: ViewerProps) {
    return (
      <UnsupportedAssetPreview
        title={props.title}
        fileTypeLabel={fileTypeLabel}
        message={`${fileTypeLabel} preview isn't available in Reloops OSS yet.`}
        downloadUrl={props.downloadUrl ?? props[urlProp] ?? null}
        fallbackDownloadUrl={props.fallbackDownloadUrl}
        downloadName={props.downloadName ?? props.title}
        annotations={props.annotations}
        onAddAnnotation={props.onAddAnnotation}
        projectId={props.projectId}
        organizationId={props.organizationId}
        workspaceId={props.workspaceId}
        assetId={props.assetId}
        asset={props.asset}
        commentsPanelOpen={props.commentsPanelOpen}
        onCommentsPanelOpenChange={props.onCommentsPanelOpenChange}
        commentMutationContext={props.commentMutationContext}
        commentEndpoint={props.commentEndpoint}
        profiles={props.profiles}
      />
    );
  };
}
