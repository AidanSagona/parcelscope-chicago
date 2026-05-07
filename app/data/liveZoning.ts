export type ZoningOverlay = {
  layer: string;
  label: string;
  value?: string;
};

export type LiveZoning = {
  zoningClass?: string;
  ordinanceNumber?: string;
  ordinanceDate?: string;
  clerkDocument?: string;
  overlays: ZoningOverlay[];
  sourceUrl: string;
};
