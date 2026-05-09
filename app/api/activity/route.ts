import { NextResponse } from "next/server";
import type { Feature, Point } from "geojson";
import type {
  ActivityEvent,
  ActivityEventFeatureCollection,
  ActivityEventProperties,
} from "../../data/activityEvents";

type Bbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type SocrataPermit = {
  id?: string;
  permit_?: string;
  permit_type?: string;
  review_type?: string;
  issue_date?: string;
  street_number?: string;
  street_direction?: string;
  street_name?: string;
  work_description?: string;
  reported_cost?: string;
  latitude?: string;
  longitude?: string;
};

type SocrataDemo = {
  id?: string;
  permit_?: string;
  permit_type?: string;
  street_number?: string;
  street_direction?: string;
  street_name?: string;
  work_description?: string;
  latitude?: string;
  longitude?: string;
};

type ArcGisFeature = {
  attributes?: Record<string, string | number | null>;
  geometry?: {
    rings?: number[][][];
  };
};

type ArcGisResponse = {
  features?: ArcGisFeature[];
};

const CHICAGO_BOUNDS = {
  west: -87.95,
  south: 41.62,
  east: -87.48,
  north: 42.05,
};
const MAX_BBOX_WIDTH = 0.12;
const MAX_BBOX_HEIGHT = 0.1;
const DEFAULT_LIMIT = 120;
const PERMITS_ENDPOINT = "https://data.cityofchicago.org/resource/ydr8-5enu.json";
const DEMO_ENDPOINT = "https://data.cityofchicago.org/resource/e4xk-pud8.json";
const PERMITS_SOURCE_URL = "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu";
const DEMO_SOURCE_URL = "https://data.cityofchicago.org/Buildings/demolition-permits/e4xk-pud8";
const ZONING_SERVICE =
  "https://gisapps.cityofchicago.org/arcgis/rest/services/ExternalApps/Zoning_update/MapServer";
const ZBA_SOURCE_URL = `${ZONING_SERVICE}/16`;
const PD_SOURCE_URL = `${ZONING_SERVICE}/2`;

function numberFromParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBbox(value: string | null): Bbox | null {
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

function bboxFromRadius(lat: number, lng: number, radiusFeet: number): Bbox {
  const latDelta = radiusFeet / 364000;
  const lngDelta = radiusFeet / (364000 * Math.cos((lat * Math.PI) / 180));

  return {
    west: Math.max(lng - lngDelta, CHICAGO_BOUNDS.west),
    south: Math.max(lat - latDelta, CHICAGO_BOUNDS.south),
    east: Math.min(lng + lngDelta, CHICAGO_BOUNDS.east),
    north: Math.min(lat + latDelta, CHICAGO_BOUNDS.north),
  };
}

function formatAddress(row: {
  street_number?: string;
  street_direction?: string;
  street_name?: string;
}) {
  return [row.street_number, row.street_direction, row.street_name].filter(Boolean).join(" ");
}

function formatArcDate(value: string | number | null | undefined) {
  if (!value || typeof value !== "number") return undefined;
  return new Date(value).toISOString().slice(0, 10);
}

function geometryCenter(rings: number[][][] | undefined): [number, number] | undefined {
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

  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
}

function distanceFeet(a: [number, number], b: [number, number]) {
  const [lngA, latA] = a;
  const [lngB, latB] = b;
  const feetPerDegreeLat = 364000;
  const referenceLat = ((latA + latB) / 2) * (Math.PI / 180);
  const feetPerDegreeLng = feetPerDegreeLat * Math.cos(referenceLat);
  return Math.hypot((lngA - lngB) * feetPerDegreeLng, (latA - latB) * feetPerDegreeLat);
}

function eventToFeature(event: ActivityEvent): Feature<Point, ActivityEventProperties> {
  const { coordinates, ...properties } = event;
  const [lng, lat] = coordinates;
  return {
    type: "Feature",
    id: event.id,
    properties: {
      ...properties,
      lng,
      lat,
    },
    geometry: {
      type: "Point",
      coordinates,
    },
  };
}

function normalizePermit(row: SocrataPermit): ActivityEvent | null {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const permitNumber = row.permit_ || row.id || "Unknown permit";
  const address = formatAddress(row);

  return {
    id: `permit-${row.id || permitNumber}`,
    kind: "permit",
    label: "P",
    title: row.permit_type || "Building permit",
    date: row.issue_date?.slice(0, 10),
    address,
    description: row.work_description,
    coordinates: [lng, lat],
    sourceName: "Building Permits",
    sourceUrl: PERMITS_SOURCE_URL,
  };
}

function normalizeDemo(row: SocrataDemo): ActivityEvent | null {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const permitNumber = row.permit_ || row.id || "Unknown demo permit";
  const address = formatAddress(row);

  return {
    id: `demo-${row.id || permitNumber}`,
    kind: "demo",
    label: "D",
    title: "Demolition permit",
    address,
    description: row.work_description || row.permit_type,
    coordinates: [lng, lat],
    sourceName: "Demolition Permits",
    sourceUrl: DEMO_SOURCE_URL,
  };
}

function normalizeZba(feature: ArcGisFeature): ActivityEvent | null {
  const attributes = feature.attributes || {};
  const center = geometryCenter(feature.geometry?.rings);
  if (!center) return null;

  const ordinance = typeof attributes.ORDINANCE === "string" ? attributes.ORDINANCE : undefined;
  const ordCase = typeof attributes.ORD_CASE === "string" ? attributes.ORD_CASE : undefined;
  const ordType = typeof attributes.ORD_TYPE === "string" ? attributes.ORD_TYPE : "ZBA";
  const address = typeof attributes.ADDRESS === "string" ? attributes.ADDRESS : undefined;
  const judgment = typeof attributes.JUDGMENT === "string" ? attributes.JUDGMENT : undefined;
  const description = typeof attributes.DESC_ === "string" ? attributes.DESC_ : undefined;

  return {
    id: `zba-${attributes.OBJECTID || ordinance || ordCase}`,
    kind: "zba",
    label: "ZBA",
    title: `${ordType} ${ordinance || ordCase || "case"}`,
    date: typeof attributes.ORD_YEAR === "string" ? attributes.ORD_YEAR : undefined,
    address,
    description: [judgment, description].filter(Boolean).join(" - ") || undefined,
    coordinates: center,
    sourceName: "Zoning Board of Appeals",
    sourceUrl: ZBA_SOURCE_URL,
  };
}

function normalizePlannedDevelopment(feature: ArcGisFeature): ActivityEvent | null {
  const attributes = feature.attributes || {};
  const center = geometryCenter(feature.geometry?.rings);
  if (!center) return null;

  const pdNumber = attributes.PD_NUM ? String(attributes.PD_NUM) : undefined;
  const zoneClass = typeof attributes.ZONE_CLASS === "string" ? attributes.ZONE_CLASS : undefined;
  const clerkUrl = typeof attributes.CLERK_URL === "string" ? attributes.CLERK_URL : undefined;
  const clerkDocument =
    typeof attributes.CLERK_DOCNO === "string" ? attributes.CLERK_DOCNO : undefined;

  return {
    id: `pd-${attributes.OBJECTID || pdNumber || zoneClass}`,
    kind: "planned-development",
    label: "PD",
    title: pdNumber ? `Planned Development ${pdNumber}` : zoneClass || "Planned Development",
    date: formatArcDate(attributes.ORDINANCE_DATE),
    description: [attributes.ORDINANCE_NUM ? `Ordinance ${attributes.ORDINANCE_NUM}` : "", clerkDocument]
      .filter(Boolean)
      .join(" - "),
    coordinates: center,
    sourceName: "Planned Developments",
    sourceUrl: clerkUrl || PD_SOURCE_URL,
  };
}

async function fetchSocrata<T>(endpoint: string, params: URLSearchParams) {
  const response = await fetch(`${endpoint}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!response.ok) return [];
  return (await response.json()) as T[];
}

async function queryArcGisLayer(layerId: number, bbox: Bbox, outFields: string, limit: number) {
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: String(limit),
  });

  const response = await fetch(`${ZONING_SERVICE}/${layerId}/query?${params.toString()}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!response.ok) return [];
  const data = (await response.json()) as ArcGisResponse;
  return data.features || [];
}

async function loadEvents(bbox: Bbox, perSourceLimit: number) {
  const permitParams = new URLSearchParams({
    $select:
      "id,permit_,permit_type,review_type,issue_date,street_number,street_direction,street_name,work_description,reported_cost,latitude,longitude",
    $where: `within_box(location, ${bbox.north}, ${bbox.west}, ${bbox.south}, ${bbox.east}) AND issue_date IS NOT NULL`,
    $order: "issue_date DESC",
    $limit: String(perSourceLimit),
  });

  const demoParams = new URLSearchParams({
    $select:
      "id,permit_,permit_type,street_number,street_direction,street_name,work_description,latitude,longitude",
    $where: `latitude between ${bbox.south} and ${bbox.north} and longitude between ${bbox.west} and ${bbox.east}`,
    $limit: String(Math.max(10, Math.floor(perSourceLimit / 2))),
  });

  const [permitRows, demoRows, zbaFeatures, pdFeatures] = await Promise.all([
    fetchSocrata<SocrataPermit>(PERMITS_ENDPOINT, permitParams),
    fetchSocrata<SocrataDemo>(DEMO_ENDPOINT, demoParams),
    queryArcGisLayer(
      16,
      bbox,
      "OBJECTID,ORDINANCE,ORD_YEAR,ORD_CASE,ORD_TYPE,ADDRESS,JUDGMENT,DESC_,PIN10,PIN_ACCURACY",
      perSourceLimit,
    ),
    queryArcGisLayer(
      2,
      bbox,
      "OBJECTID,PD_NUM,ORDINANCE_NUM,ORDINANCE_DATE,CLERK_URL,CLERK_DOCNO,ZONE_CLASS",
      Math.max(20, Math.floor(perSourceLimit / 2)),
    ),
  ]);

  return [
    ...permitRows.map(normalizePermit),
    ...demoRows.map(normalizeDemo),
    ...zbaFeatures.map(normalizeZba),
    ...pdFeatures.map(normalizePlannedDevelopment),
  ].filter((event): event is ActivityEvent => Boolean(event));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(numberFromParam(searchParams.get("limit"), DEFAULT_LIMIT), 200);
  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");
  const center =
    latParam && lngParam
      ? ([numberFromParam(lngParam, -87.6298), numberFromParam(latParam, 41.8781)] as [
          number,
          number,
        ])
      : undefined;
  const radiusFeet = Math.min(numberFromParam(searchParams.get("radiusFeet"), 1200), 5280);
  const bbox =
    center && Number.isFinite(center[0]) && Number.isFinite(center[1])
      ? bboxFromRadius(center[1], center[0], radiusFeet)
      : parseBbox(searchParams.get("bbox"));

  if (!bbox) {
    return NextResponse.json({ error: "Valid bbox or lat/lng is required." }, { status: 400 });
  }

  const width = bbox.east - bbox.west;
  const height = bbox.north - bbox.south;

  if (width > MAX_BBOX_WIDTH || height > MAX_BBOX_HEIGHT) {
    const empty: ActivityEventFeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };

    return NextResponse.json({ events: [], geojson: empty, count: 0, needsZoom: true });
  }

  try {
    const perSourceLimit = Math.max(12, Math.ceil(limit / 2));
    let events = await loadEvents(bbox, perSourceLimit);

    if (center) {
      events = events
        .map((event) => ({
          ...event,
          distanceFeet: Math.round(distanceFeet(center, event.coordinates)),
        }))
        .filter((event) => (event.distanceFeet || 0) <= radiusFeet)
        .sort((a, b) => (a.distanceFeet || 0) - (b.distanceFeet || 0));
    } else {
      events = events.sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });
    }

    events = events.slice(0, limit);

    const geojson: ActivityEventFeatureCollection = {
      type: "FeatureCollection",
      features: events.map(eventToFeature),
    };

    return NextResponse.json({
      events,
      geojson,
      count: events.length,
      source: {
        permits: PERMITS_SOURCE_URL,
        demolitions: DEMO_SOURCE_URL,
        zba: ZBA_SOURCE_URL,
        plannedDevelopments: PD_SOURCE_URL,
      },
    });
  } catch {
    return NextResponse.json({ error: "Activity feed unavailable." }, { status: 500 });
  }
}
