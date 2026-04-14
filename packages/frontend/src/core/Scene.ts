import type { SceneElement } from '../types/element.js';

export class Scene {
  private elements: Map<string, SceneElement> = new Map();

  /**
   * Returns all non-deleted elements sorted by index.
   */
  getElements(): SceneElement[] {
    return Array.from(this.elements.values())
      .filter((el) => !el.isDeleted)
      .sort((a, b) => a.index - b.index);
  }

  /**
   * Returns a single element by ID, or undefined. O(1).
   */
  getElement(id: string): SceneElement | undefined {
    return this.elements.get(id);
  }

  /**
   * Adds an element to the scene.
   */
  addElement(element: SceneElement): void {
    this.elements.set(element.id, element);
  }

  /**
   * Merges updates into an existing element, increments version, and updates timestamp.
   */
  updateElement(id: string, updates: Partial<SceneElement>): void {
    const existing = this.elements.get(id);
    if (!existing) return;
    this.elements.set(id, {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updated: Date.now(),
    } as SceneElement);
  }

  /**
   * Marks an element as deleted. Does NOT remove from the map.
   */
  deleteElement(id: string): void {
    const existing = this.elements.get(id);
    if (!existing) return;
    this.elements.set(id, { ...existing, isDeleted: true });
  }

  /**
   * Marks a deleted element as restored.
   */
  restoreElement(id: string): void {
    const existing = this.elements.get(id);
    if (!existing) return;
    this.elements.set(id, { ...existing, isDeleted: false });
  }

  /**
   * Clears the map and inserts all elements from the given array.
   */
  replaceAll(elements: SceneElement[]): void {
    this.elements.clear();
    for (const element of elements) {
      this.elements.set(element.id, element);
    }
  }

  /**
   * Returns a deep copy of all elements in the map.
   */
  snapshot(): SceneElement[] {
    return Array.from(this.elements.values()).map((el) =>
      structuredClone(el),
    );
  }

  /**
   * Computes the minimum bounding box of all non-deleted elements.
   * Returns null if there are no non-deleted elements.
   */
  getBoundingBox(): { x: number; y: number; width: number; height: number } | null {
    const visible = this.getElements();
    if (visible.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of visible) {
      if (el.type === 'line' || el.type === 'arrow' || el.type === 'freehand') {
        // For point-based elements, compute bounds from points
        const pointsEl = el as Extract<SceneElement, { points: { x: number; y: number }[] }>;
        for (const pt of pointsEl.points) {
          const px = el.x + pt.x;
          const py = el.y + pt.y;
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        }
      } else {
        // For bbox-based elements
        if (el.x < minX) minX = el.x;
        if (el.y < minY) minY = el.y;
        if (el.x + el.width > maxX) maxX = el.x + el.width;
        if (el.y + el.height > maxY) maxY = el.y + el.height;
      }
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }
}
