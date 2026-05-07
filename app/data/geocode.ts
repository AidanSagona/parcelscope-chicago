export type GeocodeResult = {
  address: string;
  score: number;
  coordinates: [number, number];
  postalCode?: string;
  sourceUrl: string;
};
