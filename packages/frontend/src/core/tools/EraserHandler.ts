/* eslint-disable @typescript-eslint/no-unused-vars -- parameters match ToolHandler interface signature */
import type { DraftElement, SceneElement } from '../../types/element';
import { findElementsAtPoint, interpolatePoints } from '../hitTesting';

const ERASER_STEP = 4;

/**
 * Factory for the object-level eraser tool handler.
 * Accepts a getElements callback to access the current scene elements.
 */
export function createEraserHandler(getElements: () => SceneElement[]) {
  let lastPoint: { x: number; y: number } | null = null;
  const hitElementIds = new Set<string>();

  return {
    onPointerDown(
      _x: number,
      _y: number,
      _setDraft: (draft: DraftElement | null) => void,
    ): void {
      lastPoint = null;
      hitElementIds.clear();
    },

    onPointerMove(
      worldX: number,
      worldY: number,
      _draft: DraftElement | null,
      _setDraft: (draft: DraftElement | null) => void,
    ): void {
      if (!lastPoint) {
        lastPoint = { x: worldX, y: worldY };
      } else {
        const points = interpolatePoints(lastPoint, { x: worldX, y: worldY }, ERASER_STEP);
        for (const pt of points) {
          const hits = findElementsAtPoint(pt.x, pt.y, getElements());
          for (const el of hits) {
            hitElementIds.add(el.id);
          }
        }
        lastPoint = { x: worldX, y: worldY };
      }
    },

    /**
     * Returns the set of element IDs hit during this eraser stroke.
     * Clears internal state after returning.
     */
    finish(): Set<string> {
      const result = new Set(hitElementIds);
      hitElementIds.clear();
      lastPoint = null;
      return result;
    },

    /**
     * Get the current set of hit element IDs (for rendering highlights).
     */
    getHitElementIds(): Set<string> {
      return hitElementIds;
    },
  };
}
