import type { SceneElement, Point } from '../types/element';

/**
 * Compute bounding box of a SceneElement in world coordinates.
 */
export function getWorldBounds(el: SceneElement): { x: number; y: number; width: number; height: number } {
  if (el.type === 'freehand' || el.type === 'line' || el.type === 'arrow') {
    const pts = el.points;
    if (pts.length === 0) return { x: el.x, y: el.y, width: 0, height: 0 };
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      x: el.x + Math.min(...xs),
      y: el.y + Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  if (el.type === 'text' && el.width === 0 && el.height === 0) {
    return { x: el.x, y: el.y, width: 100, height: el.fontSize };
  }
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/**
 * Check if a point (px, py) is inside an element's bounding box.
 */
export function pointInBoundingBox(px: number, py: number, element: SceneElement): boolean {
  const b = getWorldBounds(element);
  return px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
}

/**
 * Find all non-deleted elements that contain the given point.
 * Returns elements in reverse order (top-most first).
 */
export function findElementsAtPoint(
  px: number,
  py: number,
  elements: SceneElement[],
): SceneElement[] {
  const hits: SceneElement[] = [];
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el.isDeleted && pointInBoundingBox(px, py, el)) {
      hits.push(el);
    }
  }
  return hits;
}

/**
 * Check if two AABB rectangles intersect.
 */
export function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Find all non-deleted elements whose bounding boxes intersect the given rectangle.
 * Returns element IDs in reverse z-order (top-most first).
 */
export function findElementsInRect(
  rect: { x: number; y: number; width: number; height: number },
  elements: SceneElement[],
): string[] {
  const ids: string[] = [];
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el.isDeleted) {
      const bounds = getWorldBounds(el);
      if (rectsIntersect(rect, bounds)) {
        ids.push(el.id);
      }
    }
  }
  return ids;
}

/**
 * Interpolate points between prev and curr with given step distance.
 */
export function interpolatePoints(prev: Point, curr: Point, step: number): Point[] {
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const numSteps = Math.max(1, Math.ceil(dist / step));
  const points: Point[] = [];
  for (let i = 1; i <= numSteps; i++) {
    const t = i / numSteps;
    points.push({ x: prev.x + dx * t, y: prev.y + dy * t });
  }
  return points;
}
