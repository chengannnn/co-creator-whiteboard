export type ToolType = 'select' | 'rectangle' | 'ellipse' | 'freehand';

export interface Point {
  x: number;
  y: number;
}

export interface RectangleShape {
  id: string;
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EllipseShape {
  id: string;
  type: 'ellipse';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FreehandShape {
  id: string;
  type: 'freehand';
  points: Point[];
}

export type Shape = RectangleShape | EllipseShape | FreehandShape;
