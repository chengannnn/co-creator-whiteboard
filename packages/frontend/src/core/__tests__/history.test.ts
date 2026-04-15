import { describe, it, expect, beforeEach } from 'vitest';
import { Scene } from '../Scene';
import { HistoryManager } from '../HistoryManager';
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

describe('HistoryManager', () => {
  let scene: Scene;
  let history: HistoryManager;

  beforeEach(() => {
    scene = new Scene();
    history = new HistoryManager(scene);
  });

  // HistoryManager stores snapshots AFTER each action.
  // undo() pops the last snapshot and restores it.
  // With 3 pushes (states S1, S2, S3), undo restores S3, then S2, then S1.

  describe('push', () => {
    it('saves current state to history', () => {
      scene.addElement(makeRect('el-1', 10, 10, 50, 50));
      history.push();
      expect(history.canUndo()).toBe(true);
      expect(history.getHistoryLength()).toBe(1);
    });

    it('clears forward history when pushing', () => {
      scene.addElement(makeRect('el-1', 0, 0, 10, 10));
      history.push();

      scene.deleteElement('el-1');
      history.push();

      history.undo();
      expect(history.canRedo()).toBe(true);

      scene.deleteElement('el-1');
      history.push();
      expect(history.canRedo()).toBe(false);
    });
  });

  describe('undo', () => {
    it('returns false when history is empty', () => {
      expect(history.undo()).toBe(false);
    });

    it('restores previous snapshot correctly', () => {
      scene.addElement(makeRect('el-1', 10, 10, 50, 50));
      history.push(); // S1: [el-1]

      scene.addElement(makeRect('el-2', 100, 100, 50, 50));
      history.push(); // S2: [el-1, el-2]

      scene.deleteElement('el-2');
      history.push(); // S3: [el-1]

      // First undo: pops S3 [el-1] => scene has 1 element
      history.undo();
      expect(scene.getElements()).toHaveLength(1);

      // Second undo: pops S2 [el-1, el-2] => scene has 2 elements
      history.undo();
      expect(scene.getElements()).toHaveLength(2);
      expect(scene.getElements().map((e) => e.id)).toContain('el-2');
    });

    it('restores deleted elements correctly', () => {
      scene.addElement(makeRect('el-1', 10, 10, 50, 50));
      history.push(); // S1: [el-1]

      scene.deleteElement('el-1');
      history.push(); // S2: []

      // Undo: pops S2 [] => scene is empty
      history.undo();
      expect(scene.getElements()).toHaveLength(0);

      // Undo: pops S1 [el-1] => scene has el-1
      history.undo();
      expect(scene.getElements()).toHaveLength(1);
      expect(scene.getElements()[0].isDeleted).toBe(false);
    });
  });

  describe('redo', () => {
    it('returns false when forward history is empty', () => {
      expect(history.redo()).toBe(false);
    });

    it('restores forward snapshot correctly', () => {
      scene.addElement(makeRect('el-1', 10, 10, 50, 50));
      history.push(); // S1: [el-1]

      scene.addElement(makeRect('el-2', 100, 100, 50, 50));
      history.push(); // S2: [el-1, el-2]

      scene.deleteElement('el-2');
      history.push(); // S3: [el-1]

      // Undo: pops S3 [el-1] => scene has 1
      history.undo();
      expect(scene.getElements()).toHaveLength(1);

      // Undo: pops S2 [el-1, el-2] => scene has 2
      history.undo();
      expect(scene.getElements()).toHaveLength(2);

      // Redo: restores [el-1]
      history.redo();
      expect(scene.getElements()).toHaveLength(1);
    });
  });

  describe('undo/redo cycles', () => {
    it('multiple undo/redo cycles work without corruption', () => {
      scene.addElement(makeRect('el-1', 0, 0, 10, 10));
      history.push(); // S1: [el-1]

      scene.addElement(makeRect('el-2', 50, 50, 10, 10));
      history.push(); // S2: [el-1, el-2]

      scene.addElement(makeRect('el-3', 100, 100, 10, 10));
      history.push(); // S3: [el-1, el-2, el-3]

      scene.deleteElement('el-3');
      history.push(); // S4: [el-1, el-2]

      // Undo: pops S4 [el-1, el-2]
      history.undo();
      expect(scene.getElements()).toHaveLength(2);

      // Undo: pops S3 [el-1, el-2, el-3]
      history.undo();
      expect(scene.getElements()).toHaveLength(3);

      // Redo: restores [el-1, el-2]
      history.redo();
      expect(scene.getElements()).toHaveLength(2);

      // Undo again: restores [el-1, el-2, el-3]
      history.undo();
      expect(scene.getElements()).toHaveLength(3);

      // Redo again: restores [el-1, el-2]
      history.redo();
      expect(scene.getElements()).toHaveLength(2);
    });

    it('new action after undo clears forward history', () => {
      scene.addElement(makeRect('el-1', 0, 0, 10, 10));
      history.push(); // S1: [el-1]

      scene.addElement(makeRect('el-2', 50, 50, 10, 10));
      history.push(); // S2: [el-1, el-2]

      scene.addElement(makeRect('el-3', 100, 100, 10, 10));
      history.push(); // S3: [el-1, el-2, el-3]

      scene.deleteElement('el-3');
      history.push(); // S4: [el-1, el-2]

      // Undo: pops S4 [el-1, el-2] => scene has 2
      history.undo();
      expect(scene.getElements()).toHaveLength(2);
      expect(history.canRedo()).toBe(true);

      // New action
      scene.addElement(makeRect('el-4', 150, 150, 10, 10));
      history.push(); // clears forward, saves [el-1, el-2, el-4]

      // Forward history cleared
      expect(history.canRedo()).toBe(false);

      // Undo: pops [el-1, el-2, el-4]... no wait, that's the CURRENT push
      // Actually history is now [S1, S2, S3, [el-1,el-2,el-4]]
      // Pop gives [el-1,el-2,el-4]. Scene goes back to 3 elements
      history.undo();
      expect(scene.getElements()).toHaveLength(3);
    });
  });

  describe('clear canvas', () => {
    it('clear canvas can be fully undone', () => {
      scene.addElement(makeRect('el-1', 0, 0, 10, 10));
      scene.addElement(makeRect('el-2', 50, 50, 10, 10));
      history.push(); // S1: [el-1, el-2]

      for (const el of scene.getElements()) {
        scene.deleteElement(el.id);
      }
      history.push(); // S2: []

      scene.addElement(makeRect('el-3', 100, 100, 10, 10));
      history.push(); // S3: [el-3]

      // Undo: pops S3 [el-3] => scene has 1
      history.undo();
      expect(scene.getElements()).toHaveLength(1);

      // Undo: pops S2 [] => scene is empty
      history.undo();
      expect(scene.getElements()).toHaveLength(0);

      // Undo: pops S1 [el-1, el-2] => scene has 2, both restored
      history.undo();
      expect(scene.getElements()).toHaveLength(2);
      expect(scene.getElements()[0].isDeleted).toBe(false);
      expect(scene.getElements()[1].isDeleted).toBe(false);
    });
  });

  describe('canUndo / canRedo', () => {
    it('canUndo returns false initially', () => {
      expect(history.canUndo()).toBe(false);
    });

    it('canRedo returns false initially', () => {
      expect(history.canRedo()).toBe(false);
    });

    it('canUndo returns true after push', () => {
      scene.addElement(makeRect('el-1', 0, 0, 10, 10));
      history.push();
      expect(history.canUndo()).toBe(true);
    });

    it('canRedo returns true after undo', () => {
      scene.addElement(makeRect('el-1', 0, 0, 10, 10));
      history.push();
      scene.deleteElement('el-1');
      history.push();
      history.undo();
      expect(history.canRedo()).toBe(true);
    });

    it('canRedo returns false after redo consumes all forward history', () => {
      scene.addElement(makeRect('el-1', 0, 0, 10, 10));
      history.push();
      scene.deleteElement('el-1');
      history.push();
      history.undo();
      expect(history.canRedo()).toBe(true);
      history.redo();
      expect(history.canRedo()).toBe(false);
    });
  });
});
