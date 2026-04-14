import type { DraftElement, SceneElement, StrokeWidth, StrokeStyle, FillStyle } from '../../types/element';
import { createBaseElement, createDraft } from './helpers';

const MIN_DIMENSION = 3;

interface DrawStyle {
  strokeColor: string;
  strokeWidth: StrokeWidth;
  strokeStyle: StrokeStyle;
  fillStyle: FillStyle;
  fillColor: string;
}

/**
 * Factory for bounding-box-based shape handlers (rectangle, ellipse, rhombus).
 */
export function createBBoxHandler(type: 'rectangle' | 'ellipse' | 'rhombus', style: DrawStyle) {
  return {
    onPointerDown(worldX: number, worldY: number, setDraft: (draft: DraftElement | null) => void): void {
      const base = createBaseElement(type, worldX, worldY, style);
      setDraft(createDraft(base as SceneElement));
    },

    onPointerMove(
      worldX: number,
      worldY: number,
      draft: DraftElement | null,
      setDraft: (draft: DraftElement | null) => void,
    ): void {
      if (!draft || draft.element.type !== type) return;

      const el = draft.element;
      const x = Math.min(el.x, worldX);
      const y = Math.min(el.y, worldY);
      const width = Math.abs(worldX - el.x);
      const height = Math.abs(worldY - el.y);

      setDraft({
        ...draft,
        element: { ...el, x, y, width, height } as SceneElement,
      });
    },

    onPointerUp(
      draft: DraftElement | null,
      commitElement: (element: SceneElement) => void,
    ): SceneElement | null {
      if (!draft || draft.element.type !== type) return null;

      const el = draft.element;
      if (el.width > MIN_DIMENSION && el.height > MIN_DIMENSION) {
        const committed = { ...el, index: Date.now() } as SceneElement;
        commitElement(committed);
        return committed;
      }

      return null;
    },
  };
}
