import type { FeatureCollection, Point } from "geojson";

export type ActivityEventKind = "permit" | "demo" | "zba" | "planned-development";

export type ActivityFilterState = Record<ActivityEventKind, boolean>;

export const ACTIVITY_KIND_ORDER: ActivityEventKind[] = [
  "permit",
  "demo",
  "zba",
  "planned-development",
];

export const ACTIVITY_KIND_LABELS: Record<ActivityEventKind, string> = {
  permit: "Permits",
  demo: "Demos",
  zba: "ZBA",
  "planned-development": "PDs",
};

export function getDefaultActivityFilters(): ActivityFilterState {
  return {
    permit: true,
    demo: true,
    zba: true,
    "planned-development": true,
  };
}

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
