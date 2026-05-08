import { NextResponse } from "next/server";
import type { Feature, Polygon } from "geojson";
import type { MapParcelFeatureCollection, MapParcelProperties } from "../../data/mapParcels";

type ArcGisParcelFeature = {
  attributes?: {
    OBJECTID?: number;
    Name?: string;
    PIN10?: string;
    Ward?: string;
    MUNICIPALITY?: string;
    PARCELTYPE?: string;
    Shape_Area?: number;
  };
  geometry?: {
    rings?: number[][][];
  };
};

type ArcGisParcelResponse = {
  exceededTransferLimit?: boolean;
  features?: ArcGisParcelFeature[];
};

const PARCEL_LAYER =
  "https://gis12.cookcountyil.gov/arcgis/rest/services/parcelHistorical/MapServer/2025";
const PARCEL_QUERY_URL = `${PARCEL_LAYER}/query`;
const CHICAGO_BOUNDS = {
  west: -87.95,
  south: 41.62,
  east: -87.48,
  north: 42.05,
};
const MAX_BBOX_WIDTH = 0.09;
const MAX_BBOX_HEIGHT = 0.08;
const DEFAULT_LIMIT = 750;

function numberFromParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBbox(value: string | null) {
  const parts = value?.split(",").map((part) => Number(part.trim())) || [];
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;

  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;

  const clamped = {
    west: Math.max(west, CHICAGO_BOUNDS.west),
    south: Math.max(south, CHICAGO_BOUNDS.south),
    east: Math.min(east, CHICAGO_BOUNDS.east),
    north: Math.min(north, CHICAGO_BOUNDS.north),
  };

  if (clamped.west >= clamped.east || clamped.south >= clamped.north) return null;
  return clamped;
}

function formatPin(pin: string) {
  const digits = pin.replace(/\D/g, "");
  if (digits.length !== 14) return pin;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 7)}-${digits.slice(
    7,
    10,
  )}-${digits.slice(10, 14)}`;
}

function formatArea(area?: number) {
  if (!Number.isFinite(area)) return "Unavailable";
  return `${Math.round(area as number).toLocaleString()} sq ft`;
}

function cleanWard(ward?: string) {
  return ward?.replace(/^Chicago Ward\s+/i, "").trim();
}

function geometryCenter(rings: number[][][] | undefined) {
  const firstRing = rings?.[0] || [];
  if (!firstRing.length) return undefined;

  const bounds = firstRing.reduce(
    (current, [lng, lat]) => ({
      west: Math.min(current.west, lng),
      south: Math.min(current.south, lat),
      east: Math.max(current.east, lng),
      north: Math.max(current.north, lat),
    }),
    {
      west: Number.POSITIVE_INFINITY,
      south: Number.POSITIVE_INFINITY,
      east: Number.NEGATIVE_INFINITY,
      north: Number.NEGATIVE_INFINITY,
    },
  );

  return {
    lng: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
  };
}

function normalizeFeature(feature: ArcGisParcelFeature): Feature<Polygon, MapParcelProperties> | null {
  const attributes = feature.attributes || {};
  const rawPin = attributes.Name;
  const objectId = attributes.OBJECTID;
  const rings = feature.geometry?.rings;
  const center = geometryCenter(rings);

  if (!objectId || !rawPin || !rings?.length || !center) return null;

  const properties: MapParcelProperties = {
    id: `map-parcel-${objectId}`,
    objectId,
    pin: formatPin(rawPin),
    rawPin,
    pin10: attributes.PIN10,
    ward: cleanWard(attributes.Ward),
    municipality: attributes.MUNICIPALITY,
    parcelType: attributes.PARCELTYPE,
    lotArea: formatArea(attributes.Shape_Area),
    lotAreaSqFt: attributes.Shape_Area,
    centerLng: center.lng,
    centerLat: center.lat,
  };

  return {
    type: "Feature",
    id: properties.id,
    properties,
    geometry: {
      type: "Polygon",
      coordinates: rings,
    },
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bbox = parseBbox(searchParams.get("bbox"));
  const limit = Math.min(numberFromParam(searchParams.get("limit"), DEFAULT_LIMIT), 1000);

  if (!bbox) {
    return NextResponse.json({ error: "Valid bbox is required." }, { status: 400 });
  }

  const width = bbox.east - bbox.west;
  const height = bbox.north - bbox.south;

  if (width > MAX_BBOX_WIDTH || height > MAX_BBOX_HEIGHT) {
    const empty: MapParcelFeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };

    return NextResponse.json({
      source: PARCEL_LAYER,
      parcels: empty,
      count: 0,
      needsZoom: true,
    });
  }

  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,Name,PIN10,Ward,MUNICIPALITY,PARCELTYPE,Shape_Area",
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: String(limit),
  });

  try {
    const response = await fetch(`${PARCEL_QUERY_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to load Cook County parcels." },
        { status: response.status },
      );
    }

    const data = (await response.json()) as ArcGisParcelResponse;
    const parcels: MapParcelFeatureCollection = {
      type: "FeatureCollection",
      features: (data.features || [])
        .map(normalizeFeature)
        .filter((feature): feature is Feature<Polygon, MapParcelProperties> => Boolean(feature)),
    };

    return NextResponse.json({
      source: PARCEL_LAYER,
      parcels,
      count: parcels.features.length,
      exceededTransferLimit: Boolean(data.exceededTransferLimit),
    });
  } catch {
    return NextResponse.json({ error: "Cook County parcel map feed unavailable." }, { status: 500 });
  }
}
