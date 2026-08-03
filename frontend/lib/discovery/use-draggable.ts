'use client';

import * as React from 'react';

/**
 * Pointer-drag positioning for a floating element.
 *
 * Three problems this has to solve, and they're the reason it isn't three lines:
 *
 * 1. **The element is also a link, and contains buttons.** A drag must not
 *    navigate, and a click must not be swallowed. Movement only becomes a drag
 *    past a small threshold, and only then is the trailing click suppressed.
 * 2. **It must stay reachable.** Every position is clamped inside the viewport,
 *    and re-clamped on resize/rotate, so it can never be dragged somewhere it
 *    can't be dragged back from.
 * 3. **A mouse isn't the only input.** `nudge` moves it by keyboard, so the
 *    handle is operable without a pointer at all.
 *
 * The gesture is tracked with DOCUMENT-level listeners, not `setPointerCapture`.
 * Both keep the pointer attached once it leaves the element — which is required,
 * because a quick flick is outside the pill by the very first move event. But
 * capture also retargets the trailing `click` to the capturing element, which
 * silently breaks every button and link inside it. Document listeners give the
 * same tracking with none of that, so the same object can be both draggable and
 * clickable. They're attached only for the life of a gesture, never idly.
 *
 * The element is attached with a CALLBACK ref, not a ref object. The floating
 * element mounts a render after its owner does, and a plain `useRef` is still
 * null when a mount effect runs — a saved position would silently never be
 * restored. A callback ref fires exactly when the node appears.
 *
 * Position persists per device, because someone who moved it out of the way
 * meant it. It's stored in viewport pixels and clamped on read — a stored point
 * from a bigger window lands at the nearest valid spot rather than off-screen.
 */

const STORAGE_KEY = 'ee-island-position';
/** Below this, a gesture is a click, not a drag. */
const DRAG_THRESHOLD_PX = 6;
/**
 * How long after a drag a click is treated as part of that gesture. Browsers
 * fire the synthetic `click` immediately after `pointerup`, so this only ever
 * catches that one — a deliberate click a moment later still works.
 */
const CLICK_SUPPRESSION_MS = 250;
/** Keeps the element off the very edge of the viewport. */
const EDGE_MARGIN_PX = 8;
/** One keyboard nudge — the 8pt grid, so it lands on the same rhythm. */
const NUDGE_PX = 16;

export type Point = { x: number; y: number };

type Gesture = { dx: number; dy: number; moved: boolean; id: number };

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

function readStored(): Point | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Point).x === 'number' &&
      typeof (parsed as Point).y === 'number'
    ) {
      return parsed as Point;
    }
  } catch {
    /* corrupt or blocked — fall back to the default anchor */
  }
  return null;
}

export function useDraggable() {
  /** The node is state, so effects can depend on it actually existing. */
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  /** null = still at its default anchored position. */
  const [position, setPosition] = React.useState<Point | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const gesture = React.useRef<Gesture | null>(null);
  /**
   * The live position, mirrored outside React state.
   *
   * A pointerup handler can't read the position from `position` (it closes over
   * the value from the render the listener was created in) and must not persist
   * from inside a state updater (updaters have to stay pure — a side effect
   * there may run twice, or not at all). The ref is the value that is actually
   * current at the moment the gesture ends.
   */
  const latest = React.useRef<Point | null>(null);
  /** Tears down the current gesture's document listeners. */
  const detach = React.useRef<(() => void) | null>(null);
  /** When the last real drag ended, so its trailing click can be ignored. */
  const draggedAt = React.useRef(0);

  const clampToViewport = React.useCallback(
    (point: Point): Point => {
      const rect = node?.getBoundingClientRect();
      const width = rect?.width ?? 0;
      const height = rect?.height ?? 0;
      return {
        x: clamp(point.x, EDGE_MARGIN_PX, window.innerWidth - width - EDGE_MARGIN_PX),
        y: clamp(point.y, EDGE_MARGIN_PX, window.innerHeight - height - EDGE_MARGIN_PX),
      };
    },
    [node],
  );

  const persist = React.useCallback((point: Point | null) => {
    try {
      if (point) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(point));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage blocked — the position still applies for this session */
    }
  }, []);

  /** Move now; remember it too. */
  const commit = React.useCallback(
    (point: Point | null) => {
      latest.current = point;
      setPosition(point);
      persist(point);
    },
    [persist],
  );

  // Restore a saved position once the element exists and can be measured.
  React.useEffect(() => {
    if (!node) return;
    const stored = readStored();
    if (!stored) return;
    const clamped = clampToViewport(stored);
    latest.current = clamped;
    setPosition(clamped);
  }, [node, clampToViewport]);

  // A resize can strand it outside the viewport; pull it back.
  React.useEffect(() => {
    if (!position) return;
    const onResize = () => {
      if (!latest.current) return;
      const clamped = clampToViewport(latest.current);
      latest.current = clamped;
      setPosition(clamped);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [position, clampToViewport]);

  // A gesture in flight when this unmounts must not leave listeners behind.
  React.useEffect(() => () => detach.current?.(), []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const element = node;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    detach.current?.();
    // Remember the grab offset, so the element doesn't jump to the cursor.
    gesture.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      moved: false,
      id: event.pointerId,
    };

    const move = (moveEvent: PointerEvent) => {
      const current = gesture.current;
      if (!current || moveEvent.pointerId !== current.id) return;
      const next = { x: moveEvent.clientX - current.dx, y: moveEvent.clientY - current.dy };

      if (!current.moved) {
        const from = element.getBoundingClientRect();
        if (Math.hypot(next.x - from.left, next.y - from.top) < DRAG_THRESHOLD_PX) return;
        current.moved = true;
        setDragging(true);
      }

      const clamped = clampToViewport(next);
      latest.current = clamped;
      setPosition(clamped);
    };

    const end = (endEvent: PointerEvent) => {
      const current = gesture.current;
      if (current && endEvent.pointerId !== current.id) return;
      gesture.current = null;
      detach.current?.();
      setDragging(false);
      if (!current?.moved) return;
      draggedAt.current = Date.now();
      // Persist where it actually ended up — read from the ref, not from state.
      persist(latest.current);
    };

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    detach.current = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      detach.current = null;
    };
  };

  /** Swallow only the click the browser fires at the end of a drag. */
  const guardClick = React.useCallback((event: React.MouseEvent) => {
    if (Date.now() - draggedAt.current > CLICK_SUPPRESSION_MS) return;
    draggedAt.current = 0;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const nudge = React.useCallback(
    (dx: number, dy: number) => {
      const rect = node?.getBoundingClientRect();
      if (!rect) return;
      commit(clampToViewport({ x: rect.left + dx * NUDGE_PX, y: rect.top + dy * NUDGE_PX }));
    },
    [node, clampToViewport, commit],
  );

  const reset = React.useCallback(() => commit(null), [commit]);

  return {
    /** Attach to the element that should move. */
    setNode,
    position,
    dragging,
    /** Spread onto the drag handle. */
    handleProps: { onPointerDown },
    guardClick,
    nudge,
    reset,
  };
}
