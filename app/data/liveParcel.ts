export type ParcelGeometry = {
  type: "Polygon";
  coordinates: number[][][];
};

export type LiveParcel = {
  objectId: number;
  pin: string;
  rawPin: string;
  pin10?: string;
  ward?: string;
  municipality?: string;
  parcelType?: string;
  lotAreaSqFt?: number;
  lotArea: string;
  distanceFeet: number;
  geometry?: ParcelGeometry;
  sourceUrl: string;
};
