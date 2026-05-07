import { NextResponse } from "next/server";
import { LiveZoning, ZoningOverlay } from "../../data/liveZoning";

type ArcGisFeature = {
  attributes?: Record<string, string | number | null>;
};

type ArcGisResponse = {
  features?: ArcGisFeature[];
};

const ZONING_SERVICE =
  "https://gisapps.cityofchicago.org/arcgis/rest/services/ExternalApps/Zoning_update/MapServer";
const ZONING_SOURCE_URL =
  "https://gisapps.cityofchicago.org/arcgis/rest/services/ExternalApps/Zoning_update/MapServer/1";

const OVERLAY_LAYERS = [
  { id: 2, name: "Planned Development", field: "PD_NUM" },
  { id: 4, name: "Pedestrian Street", field: "PEDSTREET_AREANAME" },
  { id: 10, name: "Downtown Area", field: "OBJECTID" },
  { id: 17, name: "ADU Area", field: "ADU_AREA" },
  { id: 20, name: "Affordable Requirements", field: "STATUS" },
];

function numberFromParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatArcDate(value: string | number | null | undefined) {
  if (!value || typeof value !== "number") return undefined;
  return new Date(value).toISOString().slice(0, 10);
}

async function queryLayer(layerId: number, lat: number, lng: number) {
  const query = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
  });

  const response = await fetch(`${ZONING_SERVICE}/${layerId}/query?${query.toString()}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!response.ok) throw new Error(`ArcGIS layer ${layerId} failed.`);
  return (await response.json()) as ArcGisResponse;
}

function overlayFromFeature(layer: (typeof OVERLAY_LAYERS)[number], feature: ArcGisFeature) {
  const attributes = feature.attributes || {};
  const rawValue = attributes[layer.field];
  const value = rawValue === null || rawValue === undefined ? undefined : String(rawValue);
  return {
    layer: layer.name,
    label: value ? `${layer.name}: ${value}` : layer.name,
    value,
  } satisfies ZoningOverlay;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = numberFromParam(searchParams.get("lat"), 41.8781);
  const lng = numberFromParam(searchParams.get("lng"), -87.6298);

  try {
    const zoningResponse = await queryLayer(1, lat, lng);
    const zoningAttributes = zoningResponse.features?.[0]?.attributes || {};

    const overlayResponses = await Promise.all(
      OVERLAY_LAYERS.map(async (layer) => ({
        layer,
        response: await queryLayer(layer.id, lat, lng),
      })),
    );

    const overlays = overlayResponses.flatMap(({ layer, response }) =>
      (response.features || []).map((feature) => overlayFromFeature(layer, feature)),
    );

    const zoning: LiveZoning = {
      zoningClass:
        typeof zoningAttributes.ZONE_CLASS === "string" ? zoningAttributes.ZONE_CLASS : undefined,
      ordinanceNumber:
        typeof zoningAttributes.ORDINANCE_NUM === "string"
          ? zoningAttributes.ORDINANCE_NUM
          : undefined,
      ordinanceDate: formatArcDate(zoningAttributes.ORDINANCE_DATE),
      clerkDocument:
        typeof zoningAttributes.CLERK_DOCNO === "string" ? zoningAttributes.CLERK_DOCNO : undefined,
      overlays,
      sourceUrl: ZONING_SOURCE_URL,
    };

    return NextResponse.json(zoning);
  } catch {
    return NextResponse.json({ error: "Zoning feed unavailable." }, { status: 500 });
  }
}
