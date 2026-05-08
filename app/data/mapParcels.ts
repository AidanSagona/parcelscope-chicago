import type { FeatureCollection, Polygon } from "geojson";

export type MapParcelProperties = {
  id: string;
  objectId: number;
  pin: string;
  rawPin: string;
  pin10?: string;
  ward?: string;
  municipality?: string;
  parcelType?: string;
  lotArea: string;
  lotAreaSqFt?: number;
  centerLng: number;
  centerLat: number;
};

export type MapParcelFeatureCollection = FeatureCollection<Polygon, MapParcelProperties>;
