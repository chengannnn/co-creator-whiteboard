import { describe, it, expect, beforeEach } from 'vitest';
import { Scene } from '../Scene';
import type { RectangleElement, LineElement } from '../../types/element';

function makeRect(id: string, x: number, y: number, w: number, h: number, index = 0): RectangleElement {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: '#000',
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'none',
    fillColor: 'transparent',
    opacity: 100,
    version: 1,
    versionNonce: 123,
    isDeleted: false,
    groupIds: [],
    index,
    updated: Date.now(),
    ownerId: 'owner-1',
  };
}

function makeLine(id: string, x: number, y: number, points: { x: number; y: number }[], index = 0): LineElement {
  return {
    id,
    type: 'line',
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: '#000',
    strokeWidth: 2,
    strokeStyle: 'solid',
    fillStyle: 'none',
    fillColor: 'transparent',
    opacity: 100,
    version: 1,
    versionNonce: 456,
    isDeleted: false,
    groupIds: [],
    index,
    updated: Date.now(),
    ownerId: 'owner-1',
    points,
    startArrowhead: null,
    endArrowhead: null,
  };
}

describe('Scene', () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene();
  });

  describe('addElement / getElements', () => {
    it('adds an element and returns it via getElements', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);

      const elements = scene.getElements();
      expect(elements).toHaveLength(1);
      expect(elements[0].id).toBe('el-1');
    });

    it('returns elements sorted by index', () => {
      const c = makeRect('c', 0, 0, 10, 10, 2);
      const a = makeRect('a', 0, 0, 10, 10, 0);
      const b = makeRect('b', 0, 0, 10, 10, 1);
      scene.addElement(c);
      scene.addElement(a);
      scene.addElement(b);

      const elements = scene.getElements();
      expect(elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    });

    it('excludes deleted elements from getElements', () => {
      const a = makeRect('a', 0, 0, 10, 10, 0);
      const b = makeRect('b', 0, 0, 10, 10, 1);
      scene.addElement(a);
      scene.addElement(b);
      scene.deleteElement('a');

      const elements = scene.getElements();
      expect(elements).toHaveLength(1);
      expect(elements[0].id).toBe('b');
    });
  });

  describe('getElement', () => {
    it('returns element by id in O(1)', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);

      expect(scene.getElement('el-1')).toBe(rect);
      expect(scene.getElement('nonexistent')).toBeUndefined();
    });

    it('returns element even if deleted', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);
      scene.deleteElement('el-1');

      expect(scene.getElement('el-1')).toBeDefined();
      expect(scene.getElement('el-1')?.isDeleted).toBe(true);
    });
  });

  describe('updateElement', () => {
    it('merges updates into existing element', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);

      scene.updateElement('el-1', { x: 50, y: 60 });
      const updated = scene.getElement('el-1');

      expect(updated?.x).toBe(50);
      expect(updated?.y).toBe(60);
      expect(updated?.width).toBe(100); // unchanged
    });

    it('increments version by 1', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);
      const originalVersion = rect.version;

      scene.updateElement('el-1', { x: 50 });
      const updated = scene.getElement('el-1');

      expect(updated?.version).toBe(originalVersion + 1);
    });

    it('updates timestamp', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      rect.updated = 1000;
      scene.addElement(rect);

      scene.updateElement('el-1', { x: 50 });
      const updated = scene.getElement('el-1');

      expect(updated?.updated).toBeGreaterThan(1000);
    });

    it('does nothing for non-existent element', () => {
      scene.updateElement('nonexistent', { x: 50 });
      expect(scene.getElements()).toHaveLength(0);
    });
  });

  describe('deleteElement', () => {
    it('sets isDeleted to true', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);
      scene.deleteElement('el-1');

      expect(scene.getElement('el-1')?.isDeleted).toBe(true);
    });

    it('keeps element in map but excludes from getElements', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);
      scene.deleteElement('el-1');

      expect(scene.getElement('el-1')).toBeDefined();
      expect(scene.getElements()).toHaveLength(0);
    });

    it('does nothing for non-existent element', () => {
      scene.deleteElement('nonexistent');
      expect(scene.getElements()).toHaveLength(0);
    });
  });

  describe('restoreElement', () => {
    it('sets isDeleted to false', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);
      scene.deleteElement('el-1');
      scene.restoreElement('el-1');

      expect(scene.getElement('el-1')?.isDeleted).toBe(false);
      expect(scene.getElements()).toHaveLength(1);
    });

    it('does nothing for non-existent element', () => {
      scene.restoreElement('nonexistent');
      expect(scene.getElements()).toHaveLength(0);
    });
  });

  describe('replaceAll', () => {
    it('clears map and replaces with new elements', () => {
      scene.addElement(makeRect('old-1', 0, 0, 10, 10));
      scene.addElement(makeRect('old-2', 0, 0, 10, 10));

      const newEls = [makeRect('new-1', 100, 100, 50, 50)];
      scene.replaceAll(newEls);

      const elements = scene.getElements();
      expect(elements).toHaveLength(1);
      expect(elements[0].id).toBe('new-1');
      expect(scene.getElement('old-1')).toBeUndefined();
    });
  });

  describe('snapshot', () => {
    it('returns a deep copy of all elements', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);

      const snap = scene.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0].id).toBe('el-1');
      expect(snap[0]).not.toBe(rect); // deep copy
    });

    it('includes deleted elements in snapshot', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);
      scene.deleteElement('el-1');

      const snap = scene.snapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0].isDeleted).toBe(true);
    });

    it('modifying snapshot does not affect scene', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);

      const snap = scene.snapshot();
      (snap[0] as RectangleElement).x = 999;

      expect(scene.getElement('el-1')?.x).toBe(10);
    });

    it('modifying nested arrays in snapshot does not affect scene', () => {
      const line = makeLine('line-1', 0, 0, [{ x: 0, y: 0 }, { x: 50, y: 50 }]);
      scene.addElement(line);

      const snap = scene.snapshot();
      const snapLine = snap[0] as LineElement;
      snapLine.points[0].x = 999;

      const originalLine = scene.getElement('line-1') as LineElement;
      expect(originalLine.points[0].x).toBe(0);
    });
  });

  describe('getBoundingBox', () => {
    it('returns null for empty scene', () => {
      expect(scene.getBoundingBox()).toBeNull();
    });

    it('returns null when only deleted elements exist', () => {
      const rect = makeRect('el-1', 10, 20, 100, 50);
      scene.addElement(rect);
      scene.deleteElement('el-1');

      expect(scene.getBoundingBox()).toBeNull();
    });

    it('returns correct bbox for a single rectangle', () => {
      scene.addElement(makeRect('el-1', 10, 20, 100, 50));
      const bbox = scene.getBoundingBox();

      expect(bbox).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    });

    it('returns correct bbox for multiple rectangles', () => {
      scene.addElement(makeRect('a', 10, 10, 50, 50, 0));
      scene.addElement(makeRect('b', 100, 100, 50, 50, 1));
      const bbox = scene.getBoundingBox();

      expect(bbox).toEqual({ x: 10, y: 10, width: 140, height: 140 });
    });

    it('returns correct bbox for line elements', () => {
      const line = makeLine('line-1', 50, 50, [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ]);
      scene.addElement(line);
      const bbox = scene.getBoundingBox();

      // Line at (50,50) with points from (0,0) to (100,100) => world coords (50,50) to (150,150)
      expect(bbox).toEqual({ x: 50, y: 50, width: 100, height: 100 });
    });

    it('returns correct bbox for mixed element types', () => {
      scene.addElement(makeRect('rect', 0, 0, 50, 50, 0));
      scene.addElement(
        makeLine('line', 100, 100, [
          { x: 0, y: 0 },
          { x: 30, y: 40 },
        ], 1),
      );
      const bbox = scene.getBoundingBox();

      // rect: (0,0) to (50,50)
      // line: (100,100) to (130,140)
      // combined: (0,0) to (130,140)
      expect(bbox).toEqual({ x: 0, y: 0, width: 130, height: 140 });
    });
  });
});
