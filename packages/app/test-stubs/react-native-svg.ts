// Stub for react-native-svg in vitest.
// The real package ships TypeScript source via its "react-native" field
// which vitest cannot transform from node_modules.
import { forwardRef, createElement } from "react";

type SvgProps = Record<string, unknown> & { children?: unknown };

const Svg = forwardRef(function Svg(props: SvgProps, ref: unknown) {
  return createElement("svg", { ...props, ref });
});

export default Svg;

// Named shape components
function createShape(name: string) {
  return forwardRef(function Shape(props: Record<string, unknown>, ref: unknown) {
    return createElement(name.toLowerCase(), { ...props, ref });
  });
}

export const Circle = createShape("Circle");
export const ClipPath = createShape("ClipPath");
export const Defs = createShape("Defs");
export const Ellipse = createShape("Ellipse");
export const G = createShape("G");
export const Image = createShape("Image");
export const Line = createShape("Line");
export const LinearGradient = createShape("LinearGradient");
export const Mask = createShape("Mask");
export const Path = createShape("Path");
export const Pattern = createShape("Pattern");
export const Polygon = createShape("Polygon");
export const Polyline = createShape("Polyline");
export const RadialGradient = createShape("RadialGradient");
export const Rect = createShape("Rect");
export const Stop = createShape("Stop");
export const Symbol = createShape("Symbol");
export const Text = createShape("Text");
export const TextPath = createShape("TextPath");
export const TSpan = createShape("TSpan");
export const Use = createShape("Use");
