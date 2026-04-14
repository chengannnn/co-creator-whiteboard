import type { DraftElement, SceneElement } from '../../types/element';

export const EraserHandler: {
  onPointerDown: (worldX: number, worldY: number, setDraft: (draft: DraftElement | null) => void) => void;
  onPointerMove: (worldX: number, worldY: number, draft: DraftElement | null, setDraft: (draft: DraftElement | null) => void) => void;
  onPointerUp: (draft: DraftElement | null, commitElement: (element: SceneElement) => void) => SceneElement | null;
} = {
  onPointerDown(): void {
    // Eraser does not create a draft element
  },

  onPointerMove(): void {
    // Eraser rendering is handled by CanvasComponent during pointer move
    // The eraser points are tracked externally for pixel-level erasing
  },

  onPointerUp(): SceneElement | null {
    // Eraser does not create elements
    return null;
  },
};
