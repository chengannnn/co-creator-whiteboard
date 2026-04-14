import type { DraftElement, SceneElement, StrokeWidth, StrokeStyle, FillStyle } from '../../types/element';
import { createBaseElement, createDraft } from './helpers';

const MIN_POINTS = 2;

interface DrawStyle {
  strokeColor: string;
  strokeWidth: StrokeWidth;
  strokeStyle: StrokeStyle;
  fillStyle: FillStyle;
  fillColor: string;
}

export function createFreehandHandler(style: DrawStyle) {
  return {
    onPointerDown(worldX: number, worldY: number, setDraft: (draft: DraftElement | null) => void): void {
      const base = createBaseElement('freehand', worldX, worldY, style);

      const element = {
        ...base,
        points: [{ x: 0, y: 0 }],
      } as SceneElement;

      setDraft(createDraft(element));
    },

    onPointerMove(
      worldX: number,
      worldY: number,
      draft: DraftElement | null,
      setDraft: (draft: DraftElement | null) => void,
    ): void {
      if (!draft || draft.element.type !== 'freehand') return;

      const el = draft.element;
      const newPoint = { x: worldX - el.x, y: worldY - el.y };
      const points = [...el.points, newPoint];

      // Recompute bounding box from points
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);

      const updated = {
        ...el,
        points: points.map((p) => ({ x: p.x - minX, y: p.y - minY })),
        x: el.x + minX,
        y: el.y + minY,
        width: maxX - minX,
        height: maxY - minY,
      } as SceneElement;

      setDraft({ ...draft, element: updated });
    },

    onPointerUp(
      draft: DraftElement | null,
      commitElement: (element: SceneElement) => void,
    ): SceneElement | null {
      if (!draft || draft.element.type !== 'freehand') return null;

      const el = draft.element;
      if (el.points.length > MIN_POINTS) {
        const committed = { ...el, index: Date.now() } as SceneElement;
        commitElement(committed);
        return committed;
      }

      return null;
    },
  };
}
