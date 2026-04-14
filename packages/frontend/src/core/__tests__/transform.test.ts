import { describe, it, expect, vi } from 'vitest';
import { screenToWorld, worldToScreen, applyTransform } from '../transform';
import type { ViewTransform } from '../transform';

function t(scrollX: number, scrollY: number, zoom: number): ViewTransform {
  return { scrollX, scrollY, zoom };
}

describe('screenToWorld', () => {
  it('returns same coordinates when zoom=1 and no scroll', () => {
    const result = screenToWorld(100, 100, t(0, 0, 1));
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it('applies scroll offset correctly', () => {
    // screenToWorld(100, 100, { scrollX: 50, scrollY: 50, zoom: 1 })
    // = (100 - 50) / 1 = 50
    const result = screenToWorld(100, 100, t(50, 50, 1));
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it('applies zoom correctly (zoom=2)', () => {
    // screenToWorld(100, 100, { scrollX: 50, scrollY: 50, zoom: 2 })
    // = (100 - 50) / 2 = 25
    const result = screenToWorld(100, 100, t(50, 50, 2));
    expect(result).toEqual({ x: 25, y: 25 });
  });

  it('works with zoom < 1', () => {
    const result = screenToWorld(200, 200, t(0, 0, 0.5));
    expect(result).toEqual({ x: 400, y: 400 });
  });

  it('works with negative scroll', () => {
    const result = screenToWorld(100, 100, t(-50, -50, 1));
    expect(result).toEqual({ x: 150, y: 150 });
  });
});

describe('worldToScreen', () => {
  it('returns same coordinates when zoom=1 and no scroll', () => {
    const result = worldToScreen(100, 100, t(0, 0, 1));
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it('applies scroll offset correctly', () => {
    // worldToScreen(50, 50, { scrollX: 50, scrollY: 50, zoom: 1 })
    // = 50 * 1 + 50 = 100
    const result = worldToScreen(50, 50, t(50, 50, 1));
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it('applies zoom correctly', () => {
    // worldToScreen(25, 25, { scrollX: 50, scrollY: 50, zoom: 2 })
    // = 25 * 2 + 50 = 100
    const result = worldToScreen(25, 25, t(50, 50, 2));
    expect(result).toEqual({ x: 100, y: 100 });
  });

  it('works with zoom < 1', () => {
    const result = worldToScreen(400, 400, t(0, 0, 0.5));
    expect(result).toEqual({ x: 200, y: 200 });
  });
});

describe('screenToWorld and worldToScreen symmetry', () => {
  it('are inverse operations at zoom=0.1', () => {
    const transform = t(100, 200, 0.1);
    const screen = { x: 500, y: 300 };
    const world = screenToWorld(screen.x, screen.y, transform);
    const back = worldToScreen(world.x, world.y, transform);
    expect(back.x).toBeCloseTo(screen.x, 10);
    expect(back.y).toBeCloseTo(screen.y, 10);
  });

  it('are inverse operations at zoom=0.5', () => {
    const transform = t(100, 200, 0.5);
    const screen = { x: 500, y: 300 };
    const world = screenToWorld(screen.x, screen.y, transform);
    const back = worldToScreen(world.x, world.y, transform);
    expect(back.x).toBeCloseTo(screen.x, 10);
    expect(back.y).toBeCloseTo(screen.y, 10);
  });

  it('are inverse operations at zoom=1.0', () => {
    const transform = t(100, 200, 1);
    const screen = { x: 500, y: 300 };
    const world = screenToWorld(screen.x, screen.y, transform);
    const back = worldToScreen(world.x, world.y, transform);
    expect(back.x).toBeCloseTo(screen.x, 10);
    expect(back.y).toBeCloseTo(screen.y, 10);
  });

  it('are inverse operations at zoom=2.0', () => {
    const transform = t(100, 200, 2);
    const screen = { x: 500, y: 300 };
    const world = screenToWorld(screen.x, screen.y, transform);
    const back = worldToScreen(world.x, world.y, transform);
    expect(back.x).toBeCloseTo(screen.x, 10);
    expect(back.y).toBeCloseTo(screen.y, 10);
  });

  it('are inverse operations at zoom=5.0', () => {
    const transform = t(100, 200, 5);
    const screen = { x: 500, y: 300 };
    const world = screenToWorld(screen.x, screen.y, transform);
    const back = worldToScreen(world.x, world.y, transform);
    expect(back.x).toBeCloseTo(screen.x, 10);
    expect(back.y).toBeCloseTo(screen.y, 10);
  });
});

describe('applyTransform', () => {
  it('calls ctx.setTransform with correct values', () => {
    const setTransform = vi.fn();
    const ctx = { setTransform } as unknown as CanvasRenderingContext2D;
    const transform = t(100, 200, 2);

    applyTransform(ctx, transform);

    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 100, 200);
  });

  it('works with zoom=1 and no scroll', () => {
    const setTransform = vi.fn();
    const ctx = { setTransform } as unknown as CanvasRenderingContext2D;

    applyTransform(ctx, t(0, 0, 1));

    expect(setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
  });
});
