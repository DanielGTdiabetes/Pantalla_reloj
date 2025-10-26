export type PointFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, any>;
};

export type LineFeature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: Record<string, any>;
};

export type FC<T extends { type: string }> = {
  type: "FeatureCollection";
  features: T[];
};

export type AircraftFC = FC<PointFeature>;
export type ShipsFC = FC<PointFeature>;
export type CyclonesFC = FC<LineFeature>;
