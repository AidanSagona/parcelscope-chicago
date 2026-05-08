import type { Parcel } from "./sampleParcels";

export type SavedParcel = {
  id: string;
  title: string;
  coordinates: [number, number];
  pin: string;
  rawPin?: string;
  ward?: string;
  municipality?: string;
  community: string;
  lotArea: string;
  zoningClass: string;
  overlayLabels: string[];
  permitCount: number;
  savedAt: string;
  source: Parcel["source"];
};
