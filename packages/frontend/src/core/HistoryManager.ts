import { Scene } from './Scene';
import type { SceneElement } from '../types/element';

const MAX_HISTORY = 300;

export class HistoryManager {
  private scene: Scene;
  private history: SceneElement[][] = [];
  private forwardHistory: SceneElement[][] = [];

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Save the current scene state to the undo stack.
   * Call this AFTER each committed action.
   */
  push(): void {
    // Store a COPY of the snapshot so future mutations don't affect it
    const snapshot = this.scene.snapshot();
    this.history.push(snapshot);

    // 限制历史记录最大长度为 300
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }

    this.forwardHistory = [];

    // 触发场景垃圾回收，清除彻底死掉的僵尸节点
    this.scene.garbageCollect(this.history);
  }

  /**
   * Undo: pop the last saved state and restore it.
   */
  undo(): boolean {
    if (this.history.length === 0) return false;
    // Push current state to forward history for redo
    this.forwardHistory.push(this.scene.snapshot());
    // Pop from history and restore
    const state = this.history.pop()!;
    this.scene.replaceAll(state);
    return true;
  }

  /**
   * Redo: pop from forward history and restore.
   */
  redo(): boolean {
    if (this.forwardHistory.length === 0) return false;
    // Push current state back to history
    this.history.push(this.scene.snapshot());
    // Pop from forward and restore
    const state = this.forwardHistory.pop()!;
    this.scene.replaceAll(state);
    return true;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  canRedo(): boolean {
    return this.forwardHistory.length > 0;
  }

  getHistoryLength(): number {
    return this.history.length;
  }

  getForwardHistoryLength(): number {
    return this.forwardHistory.length;
  }

  clear(): void {
    this.history = [];
    this.forwardHistory = [];
  }
}
