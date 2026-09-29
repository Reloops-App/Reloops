// Shared types and utilities for image/video annotation rendering and parsing

export type Tool = "pen" | "line" | "arrow" | "rect";

export type Stroke = {
  tool: Tool;
  color?: string;
  points: { x: number; y: number }[]; // normalized 0..1 or pixel coords
};

/** Default pin colour — mirrors the first `ReviewModeBar` swatch. */
export const DEFAULT_PIN_COLOR = "#ff7a00";

/**
 * A "comment pin" is a degenerate one-point pen stroke carried inside
 * `annotation.drawing`; the pin's screen position is the centroid of the
 * drawing bounds (`getAnnotationFocusPoint`). This is the exact shape the
 * desktop viewers build (`image.tsx` / `pdf.tsx` each keep a private copy) —
 * exported here so the mobile review shell can build the same annotation.
 */
export function createAnchorStroke(
  point: { x: number; y: number },
  color: string = DEFAULT_PIN_COLOR,
): Stroke {
  return { tool: "pen", color, points: [point] };
}

export type Annotation = {
  id: string;
  time: number; // seconds; NaN for images
  page?: number; // 1-indexed page for paged documents like PDFs
  text: string;
  author?: string;
  authorId?: string; // User ID for profile lookup
  emoji?: { [k: string]: number };
  drawing?: Stroke[];
  isCompleted?: boolean; // Mark annotation as resolved/completed
  isDeleted?: boolean; // Soft delete flag
  canManageComment?: boolean; // Server-owned permission for share-link guest comments
  canDeleteComment?: boolean; // Server-owned: ownership OR workspace-admin override (delete only, not edit)
  createdAt?: string; // ISO timestamp
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isStrokeLike(s: unknown): boolean {
  if (!isRecord(s)) return false;
  return (
    (s.tool === "pen" || s.tool === "line" || s.tool === "arrow" || typeof s.tool === "string") &&
    Array.isArray(s.points)
  );
}

export function normalizeStroke(raw: unknown): Stroke | null {
  if (!isRecord(raw)) return null;
  const tool = (raw.tool === "line" || raw.tool === "arrow" || raw.tool === "rect" ? raw.tool : "pen") as Tool;
  const color: string | undefined = typeof raw.color === "string" ? raw.color : undefined;
  const pointsRaw = Array.isArray(raw.points) ? raw.points : [];
  const points = pointsRaw
    .map((p) => {
      if (!p) return null;
      if (Array.isArray(p) && p.length >= 2) {
        const [tx, ty] = p;
        if (typeof tx === "number" && typeof ty === "number") return { x: tx, y: ty };
        return null;
      }
      if (!isRecord(p)) return null;
      let usedPercent = false;
      const x =
        typeof p.x === "number"
          ? p.x
          : typeof p.px === "number"
            ? p.px
            : typeof p.xPercent === "number"
              ? ((usedPercent = true), p.xPercent)
              : null;
      const y =
        typeof p.y === "number"
          ? p.y
          : typeof p.py === "number"
            ? p.py
            : typeof p.yPercent === "number"
              ? ((usedPercent = true), p.yPercent)
              : null;
      if (x == null || y == null) return null;
      if (usedPercent) return { x: x / 100, y: y / 100 };
      return { x, y };
    })
    .filter(Boolean) as { x: number; y: number }[];
  if (!points.length) return null;
  // The live snippet review pins a comment to a page element; that anchor has
  // to survive this normalization. Absent for every other kind of stroke.
  const snippet = isRecord(raw.snippet) ? { snippet: raw.snippet } : {};
  return { tool, color, points, ...snippet } as Stroke;
}

export function parseDrawing(drawing: unknown): Stroke[] {
  try {
    let data: unknown = drawing;
    if (!data) return [];
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return [];
      }
    }
    if (Array.isArray(data)) {
      return data.map((s) => (isStrokeLike(s) ? normalizeStroke(s) : null)).filter(Boolean) as Stroke[];
    }
    if (isRecord(data) && Array.isArray(data.strokes)) {
      return data.strokes.map((s) => (isStrokeLike(s) ? normalizeStroke(s) : null)).filter(Boolean) as Stroke[];
    }
    return [];
  } catch {
    return [];
  }
}

export function normalizeAnnotation(raw: unknown): Annotation {
  const source = isRecord(raw) ? raw : {};
  const user = isRecord(source.user) ? source.user : null;
  const drawingInput = source.drawing;
  const drawingJsonInput = source.drawing_json;
  const drawingRecord = isRecord(drawingInput) ? drawingInput : null;
  const drawingJsonRecord = isRecord(drawingJsonInput) ? drawingJsonInput : null;

  const id = typeof source.id === "string" ? source.id : (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const text = typeof source.text === "string" ? source.text : typeof source.body === "string" ? source.body : "";
  const author =
    typeof source.author === "string"
      ? source.author
      : typeof source.author_name === "string"
        ? source.author_name
        : typeof user?.name === "string"
          ? user.name
          : undefined;
  const authorId = typeof source.authorId === "string" ? source.authorId : typeof source.author_user_id === "string" ? source.author_user_id : undefined;
  const emoji = isRecord(source.emoji) ? (source.emoji as { [k: string]: number }) : {};
  const drawing = parseDrawing(drawingInput ?? drawingJsonInput);
  const time = typeof source.time === "number" && Number.isFinite(source.time) ? source.time : Number.NaN;
  const pageCandidate =
    typeof source.page === "number"
      ? source.page
      : typeof drawingRecord?.page === "number"
        ? drawingRecord.page
        : typeof drawingJsonRecord?.page === "number"
          ? drawingJsonRecord.page
          : undefined;
  const page = typeof pageCandidate === "number" && Number.isFinite(pageCandidate) && pageCandidate > 0 ? Math.floor(pageCandidate) : undefined;
  const createdAt = typeof source.created_at === "string" ? source.created_at : typeof source.createdAt === "string" ? source.createdAt : undefined;
  const isCompleted = source.status === 'completed' || source.isCompleted === true;
  const isDeleted = source.status === 'deleted' || source.isDeleted === true;
  const canManageComment = source.can_manage === true || source.canManageComment === true;
  const canDeleteComment = source.can_delete === true || source.canDeleteComment === true;
  return { id, time, page, text, author, authorId, emoji, drawing, createdAt, isCompleted, isDeleted, canManageComment, canDeleteComment } as Annotation;
}

export function normalizeAnnotationList(input: Annotation[] | unknown[] | undefined | null): Annotation[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr.map((item) => normalizeAnnotation(item));
}

/**
 * Re-applies pending local edits (delete/complete/text-edit) on top of a
 * freshly-arrived `annotations` prop, keyed by annotation id.
 *
 * Every viewer keeps its own local `annotations` state and fully replaces it
 * with the latest prop whenever that prop changes (new comment added,
 * profile loaded, realtime echo, etc). Without this merge, an optimistic
 * local mutation -- e.g. marking a comment `isDeleted: true` right after the
 * user deletes it, before the server round-trip/realtime UPDATE has caught
 * up -- gets silently discarded by the *next* prop update, which still
 * carries the old (pre-delete) shape. The deleted comment then visibly
 * reappears the moment anything else changes the prop (classically: adding
 * another comment). Keeping a small `overrides` map of only the fields the
 * user has locally changed, and re-applying it on every merge, means a
 * pending mutation always wins until the incoming prop itself reflects it --
 * at which point re-applying the same value is a no-op.
 */
export function mergeAnnotationOverrides(
  items: Annotation[],
  overrides: Record<string, Partial<Annotation>>
): Annotation[] {
  return items.map((item) => {
    const override = overrides[item.id];
    return override ? { ...item, ...override } : item;
  });
}

function pointToNormalized(
  p: { x: number; y: number },
  naturalW?: number,
  naturalH?: number
) {
  const normalized = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  if (normalized) return { x: p.x, y: p.y };
  if (naturalW && naturalH && naturalW > 0 && naturalH > 0) {
    return { x: p.x / naturalW, y: p.y / naturalH };
  }
  return null;
}

export function getDrawingBounds(
  strokes: Stroke[],
  naturalW?: number,
  naturalH?: number
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      const normalized = pointToNormalized(point, naturalW, naturalH);
      if (!normalized) continue;
      minX = Math.min(minX, normalized.x);
      minY = Math.min(minY, normalized.y);
      maxX = Math.max(maxX, normalized.x);
      maxY = Math.max(maxY, normalized.y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    minX: Math.max(0, Math.min(1, minX)),
    minY: Math.max(0, Math.min(1, minY)),
    maxX: Math.max(0, Math.min(1, maxX)),
    maxY: Math.max(0, Math.min(1, maxY)),
  };
}

export function getAnnotationFocusPoint(
  annotation: Annotation,
  naturalW?: number,
  naturalH?: number
): { x: number; y: number } | null {
  const bounds = getDrawingBounds(annotation.drawing ?? [], naturalW, naturalH);
  if (!bounds) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  w: number,
  h: number,
  naturalW?: number,
  naturalH?: number,
  options: { lineWidth?: number; arrowHeadSize?: number } = {}
) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const lineWidth = options.lineWidth ?? 6;
  const arrowHeadSize = options.arrowHeadSize ?? 9;
  ctx.lineWidth = lineWidth;

  const toXY = (p: { x: number; y: number }) => {
    const normalized = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    if (normalized) return { x: p.x * w, y: p.y * h };
    if (naturalW && naturalH && naturalW > 0 && naturalH > 0) {
      return { x: (p.x / naturalW) * w, y: (p.y / naturalH) * h };
    }
    return { x: p.x, y: p.y };
  };

  const head = (x0: number, y0: number, x1: number, y1: number) => {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const size = arrowHeadSize;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - size * Math.cos(angle - Math.PI / 6), y1 - size * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - size * Math.cos(angle + Math.PI / 6), y1 - size * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };

  for (const s of strokes) {
    ctx.strokeStyle = s.color || "#ff7a00";
    if (s.tool === "pen") {
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const { x, y } = toXY(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else if (s.tool === "line" || s.tool === "arrow") {
      if (s.points.length < 2) continue;
      const a = s.points[0], b = s.points[s.points.length - 1];
      const { x: x0, y: y0 } = toXY(a);
      const { x: x1, y: y1 } = toXY(b);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      if (s.tool === "arrow") head(x0, y0, x1, y1);
    }
    else if (s.tool === "rect") {
      if (s.points.length < 2) continue;
      const a = s.points[0], b = s.points[s.points.length - 1];
      const { x: x0, y: y0 } = toXY(a);
      const { x: x1, y: y1 } = toXY(b);
      const rx = Math.min(x0, x1);
      const ry = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0);
      const rh = Math.abs(y1 - y0);
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.stroke();
    }
  }
}
