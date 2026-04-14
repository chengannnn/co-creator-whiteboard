export interface Point {
  x: number;
  y: number;
}

export type StrokeWidth = 1 | 2 | 4;
export type StrokeStyle = 'solid' | 'dashed';
export type FillStyle = 'none' | 'solid' | 'hatch';

export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'rhombus'
  | 'line'
  | 'arrow'
  | 'freehand'
  | 'text'
  | 'image';

export type ToolType = 'select' | 'rectangle' | 'rectangle-solid' | 'ellipse' | 'ellipse-solid' | 'rhombus' | 'rhombus-solid' | 'line' | 'arrow' | 'freehand' | 'eraser';

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  strokeWidth: StrokeWidth;
  strokeStyle: StrokeStyle;
  fillStyle: FillStyle;
  fillColor: string;
  roughness: number;
  opacity: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  groupIds: string[];
  index: number;
  updated: number;
  ownerId: string;
  seed: number;
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  borderRadius?: number;
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse';
}

export interface RhombusElement extends BaseElement {
  type: 'rhombus';
  borderRadius?: number;
}

export interface LineElement extends BaseElement {
  type: 'line';
  points: Point[];
  startArrowhead: Arrowhead | null;
  endArrowhead: Arrowhead | null;
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  points: Point[];
  startArrowhead: Arrowhead | null;
  endArrowhead: Arrowhead;
}

export type Arrowhead = 'arrow' | 'bar' | 'dot' | 'inverted_triangle';

export interface FreehandElement extends BaseElement {
  type: 'freehand';
  points: Point[];
}

export interface TextElement extends BaseElement {
  type: 'text';
  content: string;
  fontSize: number;
  fontFamily: string;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  fileId: string | null;
}

export type SceneElement =
  | RectangleElement
  | EllipseElement
  | RhombusElement
  | LineElement
  | ArrowElement
  | FreehandElement
  | TextElement
  | ImageElement;

export interface DraftElement {
  element: SceneElement;
  isDraft: true;
}

export interface ToolHandler {
  onPointerDown(
    worldX: number,
    worldY: number,
    setDraft: (draft: DraftElement | null) => void,
  ): void;
  onPointerMove(
    worldX: number,
    worldY: number,
    draft: DraftElement | null,
    setDraft: (draft: DraftElement | null) => void,
  ): void;
  onPointerUp(
    draft: DraftElement | null,
    commitElement: (element: SceneElement) => void,
  ): SceneElement | null;
}

export const DEFAULT_STYLE = {
  strokeColor: '#000000',
  strokeWidth: 2 as StrokeWidth,
  strokeStyle: 'solid' as StrokeStyle,
  fillStyle: 'none' as FillStyle,
  fillColor: '#000000',
};
