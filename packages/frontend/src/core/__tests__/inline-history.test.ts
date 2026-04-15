import { describe, it, expect } from 'vitest';
import { Scene } from '../Scene';
import type { RectangleElement } from '../../types/element';

function makeRect(id: string, x: number, y: number, w: number, h: number): RectangleElement {
  return {
    id, type: 'rectangle', x, y, width: w, height: h,
    angle: 0, strokeColor: '#000', strokeWidth: 1,
    strokeStyle: 'solid', fillStyle: 'none', fillColor: 'transparent',
    opacity: 100, version: 1, versionNonce: 123,
    isDeleted: false, groupIds: [], index: 0,
    updated: Date.now(), ownerId: 'owner-1',
  };
}

describe('inline history', () => {
  it('works step by step', () => {
    const scene = new Scene();
    const history: RectangleElement[][] = [];
    const forward: RectangleElement[][] = [];

    // Add el-1, push
    scene.addElement(makeRect('el-1', 10, 10, 50, 50));
    history.push(scene.snapshot() as RectangleElement[]);
    expect(scene.getElements()).toHaveLength(1);

    // Add el-2, push
    scene.addElement(makeRect('el-2', 100, 100, 50, 50));
    history.push(scene.snapshot() as RectangleElement[]);
    expect(scene.getElements()).toHaveLength(2);

    // Add el-3, push
    scene.addElement(makeRect('el-3', 200, 200, 50, 50));
    history.push(scene.snapshot() as RectangleElement[]);
    expect(scene.getElements()).toHaveLength(3);

    // Undo: save current to forward, pop from history, restore
    forward.push(scene.snapshot() as RectangleElement[]);
    const prev1 = history.pop()!;
    scene.replaceAll(prev1);
    expect(scene.getElements()).toHaveLength(3);

    // Undo again
    forward.push(scene.snapshot() as RectangleElement[]);
    const prev2 = history.pop()!;
    scene.replaceAll(prev2);
    expect(scene.getElements()).toHaveLength(2);

    // Redo
    history.push(scene.snapshot() as RectangleElement[]);
    const next1 = forward.pop()!;
    scene.replaceAll(next1);
    expect(scene.getElements()).toHaveLength(3);
  });
});
