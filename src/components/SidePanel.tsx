import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type PanelMode = "step" | "run";

const WIDTH_KEY = "openworkflow.panelWidth";
const MIN_WIDTH = 340;
const MAX_WIDTH = 680;

function initialWidth(): number {
  const stored = Number(localStorage.getItem(WIDTH_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return 420;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, stored));
}

interface SidePanelProps {
  mode: PanelMode;
  onModeChange: (mode: PanelMode) => void;
  stepLabel: string;
  runBadge?: ReactNode;
  step: ReactNode;
  run: ReactNode;
}

export function SidePanel({ mode, onModeChange, stepLabel, runBadge, step, run }: SidePanelProps) {
  const [width, setWidth] = useState(initialWidth);
  const dragging = useRef(false);
  const resizeFrame = useRef<number | undefined>(undefined);
  const pendingWidth = useRef(width);

  useEffect(() => {
    const timer = window.setTimeout(() => localStorage.setItem(WIDTH_KEY, String(width)), 150);
    return () => window.clearTimeout(timer);
  }, [width]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!dragging.current) return;
    const next = window.innerWidth - event.clientX;
    pendingWidth.current = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    if (resizeFrame.current !== undefined) return;
    resizeFrame.current = window.requestAnimationFrame(() => {
      setWidth(pendingWidth.current);
      resizeFrame.current = undefined;
    });
  }, []);

  const stopDrag = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
      if (resizeFrame.current !== undefined) window.cancelAnimationFrame(resizeFrame.current);
    };
  }, [onPointerMove, stopDrag]);

  const startDrag = () => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Keyboard resizing keeps the panel adjustable without a pointer.
  const onHandleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") setWidth((w) => Math.min(MAX_WIDTH, w + 24));
    else if (event.key === "ArrowRight") setWidth((w) => Math.max(MIN_WIDTH, w - 24));
    else return;
    event.preventDefault();
  };

  return (
    <aside className="side-panel" style={{ width }}>
      <div
        className="side-panel-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={onHandleKeyDown}
      />
      <div className="side-panel-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={mode === "step"}
          className={mode === "step" ? "is-active" : ""}
          onClick={() => onModeChange("step")}
        >
          {stepLabel}
        </button>
        <button
          role="tab"
          aria-selected={mode === "run"}
          className={mode === "run" ? "is-active" : ""}
          onClick={() => onModeChange("run")}
        >
          Run
          {runBadge}
        </button>
      </div>
      <div className="side-panel-body">{mode === "step" ? step : run}</div>
    </aside>
  );
}
