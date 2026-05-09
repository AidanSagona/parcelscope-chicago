import type { FeatureCollection, Point } from "geojson";

export type ActivityEventKind = "permit" | "demo" | "zba" | "planned-development";

export type ActivityEvent = {
  id: string;
  kind: ActivityEventKind;
  label: string;
  title: string;
  date?: string;
  address?: string;
  description?: string;
  coordinates: [number, number];
  distanceFeet?: number;
  sourceName: string;
  sourceUrl: string;
};

export type ActivityEventProperties = Omit<ActivityEvent, "coordinates"> & {
  lng: number;
  lat: number;
};

export type ActivityEventFeatureCollection = FeatureCollection<Point, ActivityEventProperties>;
