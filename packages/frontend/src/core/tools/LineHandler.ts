import type { DraftElement, SceneElement, StrokeWidth, StrokeStyle, FillStyle } from '../../types/element';
import { createBaseElement, createDraft } from './helpers';

const MIN_DISTANCE = 3;

interface DrawStyle {
  strokeColor: string;
  strokeWidth: StrokeWidth;
  strokeStyle: StrokeStyle;
  fillStyle: FillStyle;
  fillColor: string;
}

/**
 * Factory for line-based shape handlers (line, arrow).
 */
export function createLineHandler(
  type: 'line' | 'arrow',
  style: DrawStyle,
  options: { startArrowhead?: null; endArrowhead?: 'arrow' } = {},
) {
  return {
    onPointerDown(worldX: number, worldY: number, setDraft: (draft: DraftElement | null) => void): void {
      const base = createBaseElement(type, worldX, worldY, style);

      const element = {
        ...base,
        points: [{ x: 0, y: 0 }],
        startArrowhead: options.startArrowhead ?? null,
        endArrowhead: options.endArrowhead ?? null,
      } as SceneElement;

      setDraft(createDraft(element));
    },

    onPointerMove(
      worldX: number,
      worldY: number,
      draft: DraftElement | null,
      setDraft: (draft: DraftElement | null) => void,
    ): void {
      if (!draft || (draft.element.type !== 'line' && draft.element.type !== 'arrow')) return;

      const el = draft.element;
      const dx = worldX - el.x;
      const dy = worldY - el.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      const updated = {
        ...el,
        width: absDx,
        height: absDy,
        points: [
          { x: 0, y: 0 },
          { x: dx, y: dy },
        ],
      } as SceneElement;

      setDraft({ ...draft, element: updated });
    },

    onPointerUp(
      draft: DraftElement | null,
      commitElement: (element: SceneElement) => void,
    ): SceneElement | null {
      if (!draft || (draft.element.type !== 'line' && draft.element.type !== 'arrow')) return null;

      const el = draft.element;
      const pts = el.points;
      if (pts.length < 2) return null;

      const dx = Math.abs(pts[1].x);
      const dy = Math.abs(pts[1].y);
      if (dx > MIN_DISTANCE || dy > MIN_DISTANCE) {
        const committed = { ...el, index: Date.now() } as SceneElement;
        commitElement(committed);
        return committed;
      }

      return null;
    },
  };
}
