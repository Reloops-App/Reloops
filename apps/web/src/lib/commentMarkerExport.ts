import type { Annotation } from "@/components/review/annotator-utils";

const DEFAULT_FPS = 30;

export type MarkerComment = Pick<Annotation, "id" | "time" | "text" | "author" | "createdAt" | "isDeleted" | "isCompleted">;

function markerComments(comments: MarkerComment[]) {
  return comments
    .filter((comment) => !comment.isDeleted && Number.isFinite(comment.time) && comment.time >= 0 && comment.text.trim())
    .sort((left, right) => left.time - right.time);
}

function pad(value: number, size = 2) {
  return String(Math.max(0, Math.floor(value))).padStart(size, "0");
}

export function secondsToNonDropTimecode(seconds: number, fps = DEFAULT_FPS) {
  const safeFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : DEFAULT_FPS;
  const totalFrames = Math.max(0, Math.round(seconds * safeFps));
  const frames = totalFrames % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

function addFrames(seconds: number, frames: number, fps = DEFAULT_FPS) {
  const safeFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : DEFAULT_FPS;
  return seconds + frames / safeFps;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function markerTitle(comment: MarkerComment, index: number) {
  const author = comment.author?.trim();
  return author ? `${author} comment ${index}` : `Comment ${index}`;
}

function markerDescription(comment: MarkerComment) {
  const parts = [comment.text.trim()];
  if (comment.author?.trim()) parts.push(`Author: ${comment.author.trim()}`);
  if (comment.createdAt) parts.push(`Created: ${comment.createdAt}`);
  if (comment.isCompleted) parts.push("Status: resolved");
  return parts.join("\n");
}

export function buildPremiereMarkersCsv(comments: MarkerComment[], options?: { fps?: number }) {
  const fps = options?.fps ?? DEFAULT_FPS;
  const rows = [
    ["Marker Name", "Description", "In", "Out", "Duration", "Marker Type"],
    ...markerComments(comments).map((comment, index) => {
      const start = secondsToNonDropTimecode(comment.time, fps);
      const end = secondsToNonDropTimecode(addFrames(comment.time, 1, fps), fps);
      const duration = secondsToNonDropTimecode(1 / fps, fps);
      return [markerTitle(comment, index + 1), markerDescription(comment), start, end, duration, "Comment"];
    }),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function edlText(value: string) {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "/").trim();
}

export function buildDaVinciResolveMarkersEdl(comments: MarkerComment[], options?: { fps?: number; title?: string }) {
  const fps = options?.fps ?? DEFAULT_FPS;
  const title = edlText(options?.title || "Reloops Comment Markers") || "Reloops Comment Markers";
  const lines = [`TITLE: ${title}`, "FCM: NON-DROP FRAME", ""];

  markerComments(comments).forEach((comment, index) => {
    const eventNumber = pad(index + 1, 3);
    const start = secondsToNonDropTimecode(comment.time, fps);
    const end = secondsToNonDropTimecode(addFrames(comment.time, 1, fps), fps);
    const name = edlText(markerTitle(comment, index + 1));
    const description = edlText(markerDescription(comment));

    lines.push(`${eventNumber}  AX       V     C        ${start} ${end} ${start} ${end}`);
    lines.push(`* FROM CLIP NAME: ${name}`);
    lines.push(` |C:ResolveColorBlue |M:${description || name} |D:1`);
    lines.push("");
  });

  return lines.join("\n");
}

export function downloadTextFile(fileName: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeMarkerExportBaseName(name: string) {
  const trimmed = name.trim() || "asset-comments";
  return trimmed
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "asset-comments";
}
