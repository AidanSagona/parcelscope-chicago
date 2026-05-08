import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getRedis, watchlistKey } from "../../lib/watchlistStore";
import { SavedParcel } from "../../data/watchlist";
import type { Parcel } from "../../data/sampleParcels";

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asCoordinates(value: unknown): [number, number] {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  ) {
    return [Number(value[0]), Number(value[1])];
  }

  return [-87.6298, 41.8781];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asParcelSource(value: unknown): Parcel["source"] {
  return value === "geocode" || value === "map" ? value : "sample";
}

function parseStoredParcel(value: unknown): SavedParcel | null {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;

  if (!parsed || typeof parsed !== "object") return null;
  const item = parsed as SavedParcel;
  if (!item.id || !item.title || !item.pin) return null;

  return {
    id: item.id,
    title: item.title,
    coordinates: asCoordinates(item.coordinates),
    pin: item.pin,
    rawPin: asString(item.rawPin) || undefined,
    ward: asString(item.ward) || undefined,
    municipality: asString(item.municipality) || undefined,
    community: asString(item.community, "Chicago"),
    lotArea: asString(item.lotArea, "Unavailable"),
    zoningClass: asString(item.zoningClass, "Unavailable"),
    overlayLabels: asStringArray(item.overlayLabels),
    permitCount: Number.isFinite(Number(item.permitCount)) ? Number(item.permitCount) : 0,
    savedAt: item.savedAt ? new Date(item.savedAt).toISOString() : new Date().toISOString(),
    source: asParcelSource(item.source),
  };
}

function normalizeInput(input: unknown): SavedParcel {
  const item = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const title = asString(item.title);
  const pin = asString(item.pin, "Unavailable");
  const id = asString(item.id, `watch:${pin}`);

  if (!title) throw new Error("Title is required.");

  return {
    id,
    title,
    coordinates: asCoordinates(item.coordinates),
    pin,
    rawPin: asString(item.rawPin) || undefined,
    ward: asString(item.ward) || undefined,
    municipality: asString(item.municipality) || undefined,
    community: asString(item.community, "Chicago"),
    lotArea: asString(item.lotArea, "Unavailable"),
    zoningClass: asString(item.zoningClass, "Unavailable"),
    overlayLabels: asStringArray(item.overlayLabels),
    permitCount: Number.isFinite(Number(item.permitCount)) ? Number(item.permitCount) : 0,
    savedAt: new Date().toISOString(),
    source: asParcelSource(item.source),
  };
}

async function requireUserId() {
  const { userId } = await auth();
  return userId;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ items: [] }, { status: 401 });

  const redis = getRedis();
  const values = Object.values((await redis.hgetall<Record<string, unknown>>(watchlistKey(userId))) || {});
  const items = values
    .map((value) => {
      try {
        return parseStoredParcel(value);
      } catch {
        return null;
      }
    })
    .filter((item): item is SavedParcel => Boolean(item))
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const item = normalizeInput(await request.json());
    const redis = getRedis();
    await redis.hset(watchlistKey(userId), {
      [item.id]: JSON.stringify(item),
    });

    return NextResponse.json({ item });
  } catch {
    return NextResponse.json({ error: "Unable to save parcel." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing watchlist id." }, { status: 400 });

  const redis = getRedis();
  await redis.hdel(watchlistKey(userId), id);

  return NextResponse.json({ ok: true });
}
