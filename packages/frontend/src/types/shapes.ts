export type ToolType = 'select' | 'rectangle' | 'rectangle-solid' | 'ellipse' | 'ellipse-solid' | 'rhombus' | 'rhombus-solid' | 'line' | 'arrow' | 'freehand' | 'eraser';

export interface Point {
  x: number;
  y: number;
}

export type StrokeWidth = 1 | 2 | 4;
export type StrokeStyle = 'solid' | 'dashed';
export type FillStyle = 'none' | 'solid' | 'hatch';

export interface ShapeStyle {
  strokeColor: string;
  strokeWidth: StrokeWidth;
  strokeStyle: StrokeStyle;
  fillStyle: FillStyle;
  fillColor: string;
}

export interface RectangleShape {
  id: string;
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
  style: ShapeStyle;
  ownerId?: string;
}

export interface EllipseShape {
  id: string;
  type: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  style: ShapeStyle;
  ownerId?: string;
}

export interface FreehandShape {
  id: string;
  type: 'freehand';
  points: Point[];
  style: ShapeStyle;
  ownerId?: string;
}

export interface LineShape {
  id: string;
  type: 'line';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  style: ShapeStyle;
  ownerId?: string;
}

export interface TextShape {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  fontSize: number;
  style: ShapeStyle;
  ownerId?: string;
}

export interface RhombusShape {
  id: string;
  type: 'rhombus';
  x: number;
  y: number;
  width: number;
  height: number;
  style: ShapeStyle;
  ownerId?: string;
}

export interface ArrowShape {
  id: string;
  type: 'arrow';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  style: ShapeStyle;
  ownerId?: string;
}

export interface ImageShape {
  id: string;
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  style: ShapeStyle;
  ownerId?: string;
}

export const DEFAULT_STYLE: ShapeStyle = {
  strokeColor: '#000000',
  strokeWidth: 2,
  strokeStyle: 'solid',
  fillStyle: 'none',
  fillColor: '#000000',
};

export type Shape = RectangleShape | EllipseShape | FreehandShape | LineShape | TextShape | RhombusShape | ArrowShape | ImageShape;
