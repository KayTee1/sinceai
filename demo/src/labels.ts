// DOM elements for 3D-anchored labels, keyed by LabelDef id. The overlay
// registers them; the in-canvas projector positions them every frame.
export const labelElements = new Map<string, HTMLElement>();
