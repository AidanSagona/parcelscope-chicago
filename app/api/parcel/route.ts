import { NextResponse } from "next/server";
import { LiveParcel, ParcelGeometry } from "../../data/liveParcel";

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
  features?: ArcGisParcelFeature[];
};

const PARCEL_LAYER =
  "https://gis12.cookcountyil.gov/arcgis/rest/services/parcelHistorical/MapServer/2025";
const PARCEL_QUERY_URL = `${PARCEL_LAYER}/query`;

function numberFromParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function projectToFeet(coordinate: number[], referenceLat: number) {
  const [lng, lat] = coordinate;
  const feetPerDegreeLat = 364000;
  const feetPerDegreeLng = feetPerDegreeLat * Math.cos((referenceLat * Math.PI) / 180);

  return {
    x: lng * feetPerDegreeLng,
    y: lat * feetPerDegreeLat,
  };
}

function pointInRing(point: number[], ring: number[][]) {
  const [lng, lat] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i];
    const [lngJ, latJ] = ring[j];
    const intersects =
      latI > lat !== latJ > lat && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (intersects) inside = !inside;
  }

  return inside;
}

function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function distanceToPolygonFeet(point: number[], rings?: number[][][]) {
  if (!rings?.length) return Number.POSITIVE_INFINITY;
  if (pointInRing(point, rings[0])) return 0;

  const referenceLat = point[1];
  const projectedPoint = projectToFeet(point, referenceLat);
  let minDistance = Number.POSITIVE_INFINITY;

  rings.forEach((ring) => {
    for (let i = 1; i < ring.length; i++) {
      const distance = distanceToSegment(
        projectedPoint,
        projectToFeet(ring[i - 1], referenceLat),
        projectToFeet(ring[i], referenceLat),
      );
      minDistance = Math.min(minDistance, distance);
    }
  });

  return minDistance;
}

async function queryParcels(lat: number, lng: number, distanceFeet?: number) {
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,Name,PIN10,Ward,MUNICIPALITY,PARCELTYPE,Shape_Area",
    returnGeometry: "true",
    outSR: "4326",
  });

  if (distanceFeet) {
    params.set("distance", String(distanceFeet));
    params.set("units", "esriSRUnit_Foot");
  }

  const response = await fetch(`${PARCEL_QUERY_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 86400 },
  });

  if (!response.ok) throw new Error("Cook County parcel query failed.");
  return (await response.json()) as ArcGisParcelResponse;
}

function normalizeParcel(feature: ArcGisParcelFeature, lat: number, lng: number): LiveParcel | null {
  const attributes = feature.attributes || {};
  const rawPin = attributes.Name;

  if (!attributes.OBJECTID || !rawPin) return null;

  const geometry: ParcelGeometry | undefined = feature.geometry?.rings
    ? { type: "Polygon", coordinates: feature.geometry.rings }
    : undefined;

  return {
    objectId: attributes.OBJECTID,
    pin: formatPin(rawPin),
    rawPin,
    pin10: attributes.PIN10,
    ward: cleanWard(attributes.Ward),
    municipality: attributes.MUNICIPALITY,
    parcelType: attributes.PARCELTYPE,
    lotAreaSqFt: attributes.Shape_Area,
    lotArea: formatArea(attributes.Shape_Area),
    distanceFeet: Math.round(distanceToPolygonFeet([lng, lat], feature.geometry?.rings)),
    geometry,
    sourceUrl: PARCEL_LAYER,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = numberFromParam(searchParams.get("lat"), 41.8781);
  const lng = numberFromParam(searchParams.get("lng"), -87.6298);

  try {
    let response = await queryParcels(lat, lng);
    if (!response.features?.length) response = await queryParcels(lat, lng, 150);

    const parcels = (response.features || [])
      .map((feature) => normalizeParcel(feature, lat, lng))
      .filter((parcel): parcel is LiveParcel => Boolean(parcel))
      .sort((a, b) => a.distanceFeet - b.distanceFeet);

    if (!parcels.length) {
      return NextResponse.json({ error: "No nearby Cook County parcel found." }, { status: 404 });
    }

    return NextResponse.json({
      source: PARCEL_LAYER,
      parcel: parcels[0],
      candidates: parcels.slice(0, 5),
    });
  } catch {
    return NextResponse.json({ error: "Cook County parcel feed unavailable." }, { status: 500 });
  }
}
