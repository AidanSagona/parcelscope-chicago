import { NextResponse } from "next/server";
import { LivePermit } from "../../data/livePermits";

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

const PERMITS_ENDPOINT = "https://data.cityofchicago.org/resource/ydr8-5enu.json";
const PERMITS_SOURCE_URL = "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu";

function numberFromParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatAddress(row: SocrataPermit) {
  return [row.street_number, row.street_direction, row.street_name].filter(Boolean).join(" ");
}

function normalizePermit(row: SocrataPermit): LivePermit | null {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    id: row.id || row.permit_ || `${lat}-${lng}`,
    permitNumber: row.permit_ || "Unknown",
    type: row.permit_type || "Permit",
    reviewType: row.review_type,
    issueDate: row.issue_date,
    address: formatAddress(row),
    description: row.work_description,
    reportedCost: row.reported_cost,
    coordinates: [lng, lat],
    sourceUrl: PERMITS_SOURCE_URL,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = numberFromParam(searchParams.get("lat"), 41.8781);
  const lng = numberFromParam(searchParams.get("lng"), -87.6298);
  const radiusFeet = Math.min(numberFromParam(searchParams.get("radiusFeet"), 1200), 5280);
  const limit = Math.min(numberFromParam(searchParams.get("limit"), 12), 50);
  const radiusMeters = Math.round(radiusFeet * 0.3048);

  const query = new URLSearchParams({
    $select:
      "id,permit_,permit_type,review_type,issue_date,street_number,street_direction,street_name,work_description,reported_cost,latitude,longitude",
    $where: `within_circle(location, ${lat}, ${lng}, ${radiusMeters}) AND issue_date IS NOT NULL`,
    $order: "issue_date DESC",
    $limit: String(limit),
  });

  try {
    const response = await fetch(`${PERMITS_ENDPOINT}?${query.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to load Chicago permit data." },
        { status: response.status },
      );
    }

    const rows = (await response.json()) as SocrataPermit[];
    const permits = rows.map(normalizePermit).filter((permit): permit is LivePermit => Boolean(permit));

    return NextResponse.json({
      source: PERMITS_SOURCE_URL,
      radiusFeet,
      permits,
    });
  } catch {
    return NextResponse.json({ error: "Permit feed unavailable." }, { status: 500 });
  }
}
