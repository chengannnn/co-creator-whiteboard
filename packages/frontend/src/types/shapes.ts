export type ToolType = 'select' | 'rectangle' | 'ellipse' | 'freehand';

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
}

export interface EllipseShape {
  id: string;
  type: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
  style: ShapeStyle;
}

export interface FreehandShape {
  id: string;
  type: 'freehand';
  points: Point[];
  style: ShapeStyle;
}

export const DEFAULT_STYLE: ShapeStyle = {
  strokeColor: '#000000',
  strokeWidth: 2,
  strokeStyle: 'solid',
  fillStyle: 'none',
  fillColor: '#000000',
};

export type Shape = RectangleShape | EllipseShape | FreehandShape;
