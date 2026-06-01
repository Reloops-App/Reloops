// Shared types and utilities for image/video annotation rendering and parsing

export type Tool = "pen" | "line" | "arrow" | "rect";

export type Stroke = {
  tool: Tool;
  color?: string;
  points: { x: number; y: number }[]; // normalized 0..1 or pixel coords
};

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
  createdAt?: string; // ISO timestamp
};

export function isStrokeLike(s: any): boolean {
  return (
    s &&
    (s.tool === "pen" || s.tool === "line" || s.tool === "arrow" || typeof s.tool === "string") &&
    Array.isArray(s.points)
  );
}

export function normalizeStroke(raw: any): Stroke | null {
  if (!raw) return null;
  const tool = (raw.tool === "line" || raw.tool === "arrow" || raw.tool === "rect" ? raw.tool : "pen") as Tool;
  const color: string | undefined = typeof raw.color === "string" ? raw.color : undefined;
  const pointsRaw: any[] = Array.isArray(raw.points) ? raw.points : [];
  const points = pointsRaw
    .map((p) => {
      if (!p) return null;
      if (Array.isArray(p) && p.length >= 2) {
        const [tx, ty] = p;
        if (typeof tx === "number" && typeof ty === "number") return { x: tx, y: ty };
        return null;
      }
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
  return { tool, color, points };
}

export function parseDrawing(drawing: unknown): Stroke[] {
  try {
    let data: any = drawing as any;
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
    if (data && Array.isArray(data.strokes)) {
      return (data.strokes as any[]).map((s) => (isStrokeLike(s) ? normalizeStroke(s) : null)).filter(Boolean) as Stroke[];
    }
    return [];
  } catch {
    return [];
  }
}

export function normalizeAnnotation(raw: any): Annotation {
  const id = typeof raw?.id === "string" ? raw.id : (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const text = typeof raw?.text === "string" ? raw.text : typeof raw?.body === "string" ? raw.body : "";
  const author =
    typeof raw?.author === "string"
      ? raw.author
      : typeof raw?.author_name === "string"
        ? raw.author_name
        : typeof raw?.user?.name === "string"
          ? raw.user.name
          : undefined;
  const authorId = typeof raw?.authorId === "string" ? raw.authorId : typeof raw?.author_user_id === "string" ? raw.author_user_id : undefined;
  const emoji = raw?.emoji && typeof raw.emoji === "object" ? (raw.emoji as { [k: string]: number }) : {};
  const drawing = parseDrawing(raw?.drawing ?? raw?.drawing_json);
  const time = typeof raw?.time === "number" && Number.isFinite(raw.time) ? raw.time : Number.NaN;
  const pageCandidate =
    typeof raw?.page === "number"
      ? raw.page
      : typeof raw?.drawing?.page === "number"
        ? raw.drawing.page
        : typeof raw?.drawing_json?.page === "number"
          ? raw.drawing_json.page
          : undefined;
  const page = Number.isFinite(pageCandidate) && pageCandidate > 0 ? Math.floor(pageCandidate) : undefined;
  const createdAt = typeof raw?.created_at === "string" ? raw.created_at : typeof raw?.createdAt === "string" ? raw.createdAt : undefined;
  const isCompleted = raw?.status === 'completed' || raw?.isCompleted === true;
  const isDeleted = raw?.status === 'deleted' || raw?.isDeleted === true;
  return { id, time, page, text, author, authorId, emoji, drawing, createdAt, isCompleted, isDeleted } as Annotation;
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
  naturalH?: number
) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;

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
    const size = 9;
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
