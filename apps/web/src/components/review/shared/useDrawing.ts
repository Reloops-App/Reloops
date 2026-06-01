import { useMemo, useState } from "react";
import type { Stroke, Tool } from "../annotator-utils";

export type Point = { x: number; y: number };

export type UseDrawing = {
  // state
  annotating: boolean;
  setAnnotating: (v: boolean) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  draftStrokes: Stroke[];
  activeStroke: Stroke | null;
  allStrokes: Stroke[];
  // actions
  pointerDown: (p: Point) => void;
  pointerMove: (p: Point) => void;
  pointerUp: () => void;
  pointerCancel: () => void;
  undoStroke: () => void;
  clearStrokes: () => void;
  addStroke: (stroke: Stroke, replace?: boolean) => void;
};

export function useDrawing(initialColor = "#ff7a00", initialTool: Tool = "pen"): UseDrawing {
  const [annotating, setAnnotating] = useState(false);
  const [tool, setTool] = useState<Tool>(initialTool);
  const [color, setColor] = useState<string>(initialColor);
  const [draftStrokes, setDraftStrokes] = useState<Stroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<Stroke | null>(null);

  const allStrokes = useMemo(
    () => [...draftStrokes, ...(activeStroke ? [activeStroke] : [])],
    [draftStrokes, activeStroke]
  );

  const pointerDown = (p: Point) => {
    if (!annotating) return;
    setActiveStroke({ tool, color, points: [p] });
  };
  const pointerMove = (p: Point) => {
    if (!annotating || !activeStroke) return;
    if (activeStroke.tool === "pen") {
      setActiveStroke((s: Stroke | null) => (s ? { ...s, points: [...s.points, p] } : s));
    } else {
      setActiveStroke((s: Stroke | null) => (s ? { ...s, points: [s.points[0], p] } : s));
    }
  };
  const pointerUp = () => {
    if (!activeStroke) return;
    setDraftStrokes((arr: Stroke[]) => [...arr, activeStroke]);
    setActiveStroke(null);
  };
  const pointerCancel = () => {
    setActiveStroke(null);
  };
  const undoStroke = () => setDraftStrokes((arr: Stroke[]) => arr.slice(0, -1));
  const clearStrokes = () => {
    setDraftStrokes([]);
    setActiveStroke(null);
  };
  const addStroke = (stroke: Stroke, replace = false) => {
    setDraftStrokes((arr: Stroke[]) => (replace ? [stroke] : [...arr, stroke]));
    setActiveStroke(null);
  };

  return {
    annotating,
    setAnnotating,
    tool,
    setTool,
    color,
    setColor,
    draftStrokes,
    activeStroke,
    allStrokes,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    undoStroke,
    clearStrokes,
    addStroke,
  };
}
