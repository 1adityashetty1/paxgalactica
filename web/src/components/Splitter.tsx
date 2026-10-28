import { useRef } from 'react';
import { dragged, type Pane } from '../../../src/ui/panes.js';

/**
 * A handle the player drags to resize one pane, and double-clicks to put it
 * back. `measure` reads the pane's size when the drag starts, so a pane still
 * at its stylesheet default is dragged from where it actually is.
 */
export function Splitter({
  pane,
  measure,
  onResize,
  onDone,
  onReset,
}: {
  pane: Pane;
  measure: () => number | null;
  onResize: (px: number) => void;
  onDone: () => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; y: number; start: number } | null>(null);
  const vertical = pane === 'side';
  return (
    <div
      className={vertical ? 'splitter splitter-v' : 'splitter splitter-h'}
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        const start = measure();
        if (start === null) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, start };
        document.body.classList.add(vertical ? 'resizing-v' : 'resizing-h');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        onResize(
          dragged(pane, d.start, { x: e.clientX - d.x, y: e.clientY - d.y }, { width: window.innerWidth, height: window.innerHeight }),
        );
      }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        drag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove('resizing-v', 'resizing-h');
        onDone();
      }}
      onDoubleClick={onReset}
    />
  );
}
