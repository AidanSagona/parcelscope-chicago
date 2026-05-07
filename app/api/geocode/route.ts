import { NextResponse } from "next/server";
import { GeocodeResult } from "../../data/geocode";

type ArcGisCandidate = {
  address?: string;
  score?: number;
  location?: {
    x?: number;
    y?: number;
  };
  attributes?: {
    Match_addr?: string;
    Postal?: string;
  };
};

type ArcGisGeocodeResponse = {
  candidates?: ArcGisCandidate[];
};

const GEOCODER_ENDPOINT =
  "https://gisapps.chicago.gov/arcgis/rest/services/GeoStreets/GeocodeServer/findAddressCandidates";

function normalizeCandidate(candidate: ArcGisCandidate): GeocodeResult | null {
  const lng = Number(candidate.location?.x);
  const lat = Number(candidate.location?.y);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    address: candidate.address || candidate.attributes?.Match_addr || "Chicago address",
    score: candidate.score || 0,
    coordinates: [lng, lat],
    postalCode: candidate.attributes?.Postal,
    sourceUrl: GEOCODER_ENDPOINT,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Enter a longer Chicago address." }, { status: 400 });
  }

  const params = new URLSearchParams({
    f: "json",
    SingleLine: query,
    outFields: "*",
    maxLocations: "5",
    outSR: "4326",
  });

  try {
    const response = await fetch(`${GEOCODER_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Chicago geocoder failed." }, { status: response.status });
    }

    const data = (await response.json()) as ArcGisGeocodeResponse;
    const results = (data.candidates || [])
      .map(normalizeCandidate)
      .filter((result): result is GeocodeResult => Boolean(result))
      .filter((result) => result.score >= 70);

    return NextResponse.json({
      source: GEOCODER_ENDPOINT,
      results,
    });
  } catch {
    return NextResponse.json({ error: "Chicago geocoder unavailable." }, { status: 500 });
  }
}
