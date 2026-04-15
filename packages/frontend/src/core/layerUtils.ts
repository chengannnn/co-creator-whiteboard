import type { SceneElement } from '../types/element';

/**
 * Brings the element with the given ID to the front of the rendering order.
 * Mutates the element's index and returns the re-sorted array.
 */
export function bringToFront(elements: SceneElement[], id: string): SceneElement[] {
  const target = elements.find((el) => el.id === id);
  if (!target) return elements;

  const maxIndex = elements.reduce((max, el) => Math.max(max, el.index), -Infinity);
  target.index = maxIndex + 1;
  elements.sort((a, b) => a.index - b.index);
  return elements;
}

/**
 * Sends the element with the given ID to the back of the rendering order.
 * Mutates the element's index and returns the re-sorted array.
 */
export function sendToBack(elements: SceneElement[], id: string): SceneElement[] {
  const target = elements.find((el) => el.id === id);
  if (!target) return elements;

  const minIndex = elements.reduce((min, el) => Math.min(min, el.index), Infinity);
  target.index = minIndex - 1;
  elements.sort((a, b) => a.index - b.index);
  return elements;
}

/**
 * Swaps the element with the given ID one layer forward (toward front).
 * Returns the re-sorted array.
 */
export function bringForward(elements: SceneElement[], id: string): SceneElement[] {
  const i = elements.findIndex((el) => el.id === id);
  if (i < 0 || i >= elements.length - 1) return elements;

  // Swap indices with the next element
  const temp = elements[i].index;
  elements[i].index = elements[i + 1].index;
  elements[i + 1].index = temp;
  elements.sort((a, b) => a.index - b.index);
  return elements;
}

/**
 * Swaps the element with the given ID one layer backward (toward back).
 * Returns the re-sorted array.
 */
export function sendBackward(elements: SceneElement[], id: string): SceneElement[] {
  const i = elements.findIndex((el) => el.id === id);
  if (i <= 0) return elements;

  // Swap indices with the previous element
  const temp = elements[i].index;
  elements[i].index = elements[i - 1].index;
  elements[i - 1].index = temp;
  elements.sort((a, b) => a.index - b.index);
  return elements;
}
