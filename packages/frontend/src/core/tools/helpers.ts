import type { SceneElement, DraftElement, StrokeWidth, StrokeStyle, FillStyle } from '../../types/element';

let nextId = 1;

/**
 * Generate a unique element ID.
 */
export function generateElementId(): string {
  return `el_${Date.now()}_${nextId++}`;
}

/**
 * Create a base element object with common fields for a new element.
 */
export function createBaseElement(
  type: SceneElement['type'],
  x: number,
  y: number,
  style: {
    strokeColor: string;
    strokeWidth: StrokeWidth;
    strokeStyle: StrokeStyle;
    fillStyle: FillStyle;
    fillColor: string;
  },
): Omit<SceneElement, 'width' | 'height'> & { width: number; height: number } {
  return {
    id: generateElementId(),
    type,
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    fillStyle: style.fillStyle,
    fillColor: style.fillColor,
    roughness: 1,
    opacity: 1,
    version: 1,
    versionNonce: Math.floor(Math.random() * 1e9),
    isDeleted: false,
    groupIds: [],
    index: 0,
    updated: Date.now(),
    ownerId: '',
    seed: Math.floor(Math.random() * 1e9),
  };
}

/**
 * Create a draft element wrapper.
 */
export function createDraft(element: SceneElement): DraftElement {
  return { element, isDraft: true };
}
