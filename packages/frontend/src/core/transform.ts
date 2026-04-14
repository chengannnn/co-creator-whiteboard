export interface ViewTransform {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/**
 * Convert screen coordinates to world coordinates.
 * Formula: (screen - scroll) / zoom
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  transform: ViewTransform,
): { x: number; y: number } {
  return {
    x: (screenX - transform.scrollX) / transform.zoom,
    y: (screenY - transform.scrollY) / transform.zoom,
  };
}

/**
 * Convert world coordinates to screen coordinates.
 * Formula: world * zoom + scroll
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  transform: ViewTransform,
): { x: number; y: number } {
  return {
    x: worldX * transform.zoom + transform.scrollX,
    y: worldY * transform.zoom + transform.scrollY,
  };
}

/**
 * Apply the view transform to a canvas 2D context.
 * Uses ctx.setTransform(zoom, 0, 0, zoom, scrollX, scrollY).
 */
export function applyTransform(
  ctx: CanvasRenderingContext2D,
  transform: ViewTransform,
): void {
  ctx.setTransform(transform.zoom, 0, 0, transform.zoom, transform.scrollX, transform.scrollY);
}
