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
   * Replaces the current state with the provided elements.
   * Elements missing from the new state are marked as logically deleted,
   * preserving their existence for Undo/Redo synchronization.
   */
  replaceAll(elements: SceneElement[]): void {
    const newIds = new Set(elements.map((e) => e.id));

    // 1. 对于当前场景中存在，但新快照中不存在的元素，不要物理删除，而是标记为逻辑删除
    for (const [id, el] of this.elements.entries()) {
      if (!newIds.has(id)) {
        if (!el.isDeleted) {
          this.elements.set(id, {
            ...el,
            isDeleted: true,
            version: el.version + 1,
            updated: Date.now(),
          } as SceneElement);
        }
      }
    }

    // 2. 正常覆盖/插入快照中的元素
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
   * Groups selected elements by assigning a shared groupId.
   * Returns the generated groupId, or null if fewer than 2 elements.
   */
  groupElements(elementIds: string[]): string | null {
    if (elementIds.length < 2) return null;
    const groupId = crypto.randomUUID();
    for (const id of elementIds) {
      const existing = this.elements.get(id);
      if (!existing) continue;
      this.elements.set(id, {
        ...existing,
        groupIds: [...existing.groupIds, groupId],
        version: existing.version + 1,
        updated: Date.now(),
      } as SceneElement);
    }
    return groupId;
  }

  /**
   * Ungroups elements that share the given groupId.
   * Only removes the specified groupId from each element.
   */
  ungroupElements(elementIds: string[], groupId: string): void {
    for (const id of elementIds) {
      const existing = this.elements.get(id);
      if (!existing) continue;
      this.elements.set(id, {
        ...existing,
        groupIds: existing.groupIds.filter((g) => g !== groupId),
        version: existing.version + 1,
        updated: Date.now(),
      } as SceneElement);
    }
  }

  /**
   * Returns all element IDs that share any groupId with the given element.
   * Returns an empty array if the element has no groupIds.
   */
  getGroupElementIds(elementId: string): string[] {
    const el = this.elements.get(elementId);
    if (!el || el.groupIds.length === 0) return [];
    const groupIds = new Set(el.groupIds);
    const result: string[] = [];
    for (const [id, candidate] of this.elements) {
      if (candidate.isDeleted) continue;
      if (candidate.groupIds.some((g) => groupIds.has(g))) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * 物理删除那些已经被逻辑删除，且无法通过当前历史栈撤销复活的元素。
   */
  garbageCollect(historySnapshots: SceneElement[][]): void {
    // 收集在任何历史快照中仍然存活（未被删除）的元素 ID
    const recoverableIds = new Set<string>();
    for (const snapshot of historySnapshots) {
      for (const el of snapshot) {
        if (!el.isDeleted) {
          recoverableIds.add(el.id);
        }
      }
    }

    // 如果当前场景中的元素已被逻辑删除，且在历史栈中找不到存活的备份，则彻底物理删除它
    for (const [id, el] of this.elements.entries()) {
      if (el.isDeleted && !recoverableIds.has(id)) {
        this.elements.delete(id);
      }
    }
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
