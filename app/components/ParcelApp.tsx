"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import dynamic from "next/dynamic";
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KIND_ORDER,
  getDefaultActivityFilters,
  type ActivityEvent,
  type ActivityEventKind,
} from "../data/activityEvents";
import { GeocodeResult } from "../data/geocode";
import { LiveParcel } from "../data/liveParcel";
import { Parcel, parcels, sourceLinks } from "../data/sampleParcels";
import { LivePermit } from "../data/livePermits";
import { LiveZoning } from "../data/liveZoning";
import { SavedParcel } from "../data/watchlist";

const ChicagoMap = dynamic(() => import("./ChicagoMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading Chicago map...</div>,
});

const ACTIVITY_RADIUS_OPTIONS = [
  { label: "500 ft", value: 500 },
  { label: "1,200 ft", value: 1200 },
  { label: "0.5 mi", value: 2640 },
];

type MemoCitation = {
  id: string;
  label: string;
  url: string;
  note: string;
};

type MemoFact = {
  label: string;
  value: string;
  citationId: string;
};

type MemoRecord = {
  title: string;
  meta: string;
  description?: string;
  citationId: string;
  sourceUrl: string;
  sourceName: string;
};

type SiteMemoReport = {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedLabel: string;
  summary: string;
  parcelFacts: MemoFact[];
  zoningFacts: MemoFact[];
  overlays: string[];
  activityItems: MemoRecord[];
  permitItems: MemoRecord[];
  verificationItems: string[];
  citations: MemoCitation[];
  plainText: string;
};

function matchParcel(query: string): Parcel | undefined {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return parcels[0];

  return parcels.find((parcel) => {
    const haystack = [parcel.title, parcel.pin, parcel.zoning, ...parcel.aliases]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

function parcelFromGeocode(result: GeocodeResult, query: string): Parcel {
  return {
    id: `geocode-${result.coordinates.join("-")}`,
    title: result.address,
    pin: "Parcel join pending",
    aliases: [query, result.address],
    ward: "Pending parcel join",
    community: result.postalCode ? `ZIP ${result.postalCode}` : "Chicago",
    lotArea: "Pending parcel geometry",
    zoning: "Live lookup",
    zoningSummary:
      "This is a geocoded address point. Parcel boundary, zoning, overlays, and permits refresh from official feeds.",
    badges: ["Live address lookup"],
    activity: [],
    coordinates: result.coordinates,
    source: "geocode",
  };
}

function coordinatesFromLiveParcel(parcel: LiveParcel): [number, number] {
  const firstRing = parcel.geometry?.coordinates[0] || [];
  if (!firstRing.length) return [-87.6298, 41.8781];

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

function parcelFromLiveParcel(parcel: LiveParcel, query: string): Parcel {
  return {
    id: `map-parcel-${parcel.objectId}`,
    title: `Parcel ${parcel.pin}`,
    pin: parcel.pin,
    aliases: [query, parcel.pin, parcel.rawPin, parcel.pin10 || ""].filter(Boolean),
    ward: parcel.ward || "Unavailable",
    community: parcel.municipality || "Chicago",
    lotArea: parcel.lotArea,
    zoning: "Live lookup",
    zoningSummary:
      "Cook County parcel selected from the live parcel feed. Zoning, overlays, and permits refresh from official feeds.",
    badges: ["Cook County parcel"],
    activity: [],
    coordinates: coordinatesFromLiveParcel(parcel),
    source: "map",
  };
}

function createCitationCollector() {
  const citations: MemoCitation[] = [];

  function cite(label: string, url: string, note: string) {
    const existing = citations.find((citation) => citation.url === url);
    if (existing) return existing.id;

    const citation: MemoCitation = {
      id: `S${citations.length + 1}`,
      label,
      url,
      note,
    };
    citations.push(citation);
    return citation.id;
  }

  return { citations, cite };
}

function buildReportText(report: Omit<SiteMemoReport, "plainText">) {
  const parcelFacts = report.parcelFacts
    .map((fact) => `- ${fact.label}: ${fact.value} [${fact.citationId}]`)
    .join("\n");
  const zoningFacts = report.zoningFacts
    .map((fact) => `- ${fact.label}: ${fact.value} [${fact.citationId}]`)
    .join("\n");
  const overlays = report.overlays.length
    ? report.overlays.map((overlay) => `- ${overlay}`).join("\n")
    : "- No overlay flags loaded.";
  const activity = report.activityItems.length
    ? report.activityItems
        .map((item) => `- ${item.title} - ${item.meta} [${item.citationId}]`)
        .join("\n")
    : "- No matching approval, demolition, ZBA, or planned-development signals loaded.";
  const permits = report.permitItems.length
    ? report.permitItems
        .map((item) => `- ${item.title} - ${item.meta} [${item.citationId}]`)
        .join("\n")
    : "- No permit records loaded in the selected radius.";
  const verification = report.verificationItems.map((item) => `- ${item}`).join("\n");
  const citations = report.citations
    .map((citation) => `[${citation.id}] ${citation.label}: ${citation.url}`)
    .join("\n");

  return `${report.title}
${report.subtitle}
Generated ${report.generatedLabel}

Summary
${report.summary}

Parcel facts
${parcelFacts}

Zoning and overlays
${zoningFacts}
${overlays}

Nearby activity
${activity}

Permit feed
${permits}

Manual verification
${verification}

Sources
${citations}

Informational triage memo only. Confirm zoning and entitlement status with the City and qualified professionals before acting.`;
}

function buildSiteMemoReport(
  parcel: Parcel,
  liveZoning?: LiveZoning,
  liveParcel?: LiveParcel,
  livePermits: LivePermit[] = [],
  activityEvents: ActivityEvent[] = [],
  activityRadiusFeet = 1200,
): SiteMemoReport {
  const { citations, cite } = createCitationCollector();
  const parcelCitationId = cite(
    "Cook County parcel layer",
    sourceLinks.parcels,
    "Parcel boundary, PIN, ward, municipality, and lot-area reference.",
  );
  const zoningCitationId = cite(
    "Chicago zoning service",
    liveZoning?.sourceUrl || sourceLinks.zoning,
    "Current zoning class, ordinance fields, and overlay flags.",
  );
  const permitCitationId = cite(
    "Chicago building permits",
    sourceLinks.permits,
    "Permit activity near the selected parcel.",
  );
  const pin = liveParcel?.pin || parcel.pin;
  const ward = liveParcel ? liveParcel.ward || "Unavailable" : parcel.ward;
  const municipality = liveParcel?.municipality || parcel.community;
  const lotArea = liveParcel?.lotArea || parcel.lotArea;
  const zoningClass = liveZoning?.zoningClass || parcel.zoning;
  const overlays = liveZoning?.overlays.length
    ? liveZoning.overlays.map((overlay) => overlay.label)
    : parcel.badges;
  const generatedAt = new Date();
  const generatedLabel = generatedAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const radiusLabel = formatActivityRadius(activityRadiusFeet);
  const activityItems = activityEvents.slice(0, 12).map((event) => {
    const citationId = cite(
      event.sourceName,
      event.sourceUrl,
      `${formatActivityKind(event)} activity source.`,
    );
    return {
      title: `${formatActivityKind(event)}: ${event.title}`,
      meta: [event.date, event.address, formatDistance(event.distanceFeet)]
        .filter(Boolean)
        .join(" - "),
      description: event.description,
      citationId,
      sourceUrl: event.sourceUrl,
      sourceName: event.sourceName,
    };
  });
  const permitItems = livePermits.slice(0, 8).map((permit) => ({
    title: `${permit.type}: ${permit.address || permit.permitNumber}`,
    meta: [
      permit.issueDate?.slice(0, 10) || "Unknown date",
      permit.reviewType || "Review type unavailable",
    ].join(" - "),
    description: permit.description,
    citationId: permitCitationId,
    sourceUrl: permit.sourceUrl || sourceLinks.permits,
    sourceName: "Building Permits",
  }));
  const summary = [
    `${parcel.title} is identified as PIN ${pin} in Ward ${ward}.`,
    `The current zoning snapshot is ${zoningClass}, with ${overlays.length} overlay or badge signal${
      overlays.length === 1 ? "" : "s"
    } loaded.`,
    `Within ${radiusLabel}, the app found ${activityEvents.length} approval/activity signal${
      activityEvents.length === 1 ? "" : "s"
    } and ${livePermits.length} permit record${livePermits.length === 1 ? "" : "s"}.`,
  ].join(" ");
  const reportBase: Omit<SiteMemoReport, "plainText"> = {
    title: `${parcel.title} Site Memo`,
    subtitle: `Parcel-first zoning and approvals snapshot for ${municipality}`,
    generatedAt: generatedAt.toISOString(),
    generatedLabel,
    summary,
    parcelFacts: [
      { label: "PIN", value: pin, citationId: parcelCitationId },
      { label: "Ward", value: ward, citationId: parcelCitationId },
      { label: "Municipality / area", value: municipality, citationId: parcelCitationId },
      { label: "Lot area", value: lotArea, citationId: parcelCitationId },
    ],
    zoningFacts: [
      { label: "Zoning class", value: zoningClass, citationId: zoningCitationId },
      {
        label: "Ordinance",
        value: [liveZoning?.ordinanceNumber, liveZoning?.ordinanceDate, liveZoning?.clerkDocument]
          .filter(Boolean)
          .join(" - ") || "Not loaded",
        citationId: zoningCitationId,
      },
    ],
    overlays,
    activityItems,
    permitItems,
    verificationItems: [
      "Confirm zoning class, overlays, and ordinance references against the City zoning service.",
      "Open the cited permit, ZBA, planned-development, and demolition records before making entitlement assumptions.",
      "Treat this as deal-triage intelligence, not a legal zoning opinion or permit filing determination.",
    ],
    citations,
  };

  return {
    ...reportBase,
    plainText: buildReportText(reportBase),
  };
}

function citationUrl(report: SiteMemoReport, citationId: string) {
  return report.citations.find((citation) => citation.id === citationId)?.url || "#";
}

function getWatchlistKey(parcel: Parcel, liveParcel?: LiveParcel) {
  return liveParcel?.rawPin ? `pin:${liveParcel.rawPin}` : parcel.id;
}

function savedParcelFromCurrent(
  parcel: Parcel,
  liveParcel: LiveParcel | undefined,
  liveZoning: LiveZoning | undefined,
  livePermits: LivePermit[],
): SavedParcel {
  return {
    id: getWatchlistKey(parcel, liveParcel),
    title: parcel.title,
    coordinates: parcel.coordinates,
    pin: liveParcel?.pin || parcel.pin,
    rawPin: liveParcel?.rawPin,
    ward: liveParcel?.ward || parcel.ward,
    municipality: liveParcel?.municipality,
    community: parcel.community,
    lotArea: liveParcel?.lotArea || parcel.lotArea,
    zoningClass: liveZoning?.zoningClass || parcel.zoning,
    overlayLabels: liveZoning?.overlays.length
      ? liveZoning.overlays.map((overlay) => overlay.label)
      : parcel.badges,
    permitCount: livePermits.length,
    savedAt: new Date().toISOString(),
    source: parcel.source,
  };
}

function parcelFromSaved(item: SavedParcel): Parcel {
  return {
    id: item.id,
    title: item.title,
    pin: item.pin,
    aliases: [item.title, item.pin, item.rawPin || ""].filter(Boolean),
    ward: item.ward || "Unavailable",
    community: item.municipality || item.community,
    lotArea: item.lotArea,
    zoning: item.zoningClass,
    zoningSummary: "Saved parcel. Live parcel, zoning, and permit feeds refresh when opened.",
    badges: item.overlayLabels.length ? item.overlayLabels : ["Saved parcel"],
    activity: [],
    coordinates: item.coordinates,
    source: item.source,
  };
}

function formatSavedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDistance(value?: number) {
  if (!Number.isFinite(value)) return "";
  return `${Math.round(value as number).toLocaleString()} ft`;
}

function formatActivityRadius(value: number) {
  if (value >= 2640) {
    return `${(value / 5280).toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`;
  }

  return `${value.toLocaleString()} ft`;
}

function formatActivityKind(event: ActivityEvent) {
  if (event.kind === "planned-development") return "Planned Development";
  if (event.kind === "zba") return "ZBA";
  if (event.kind === "demo") return "Demo";
  return "Permit";
}

function emptyActivityCounts(): Record<ActivityEventKind, number> {
  return {
    permit: 0,
    demo: 0,
    zba: 0,
    "planned-development": 0,
  };
}

export default function ParcelApp() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useUser();
  const [selectedParcel, setSelectedParcel] = useState<Parcel | undefined>(parcels[0]);
  const [query, setQuery] = useState("");
  const [savedParcels, setSavedParcels] = useState<SavedParcel[]>([]);
  const [watchlistReady, setWatchlistReady] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const [isSavingParcel, setIsSavingParcel] = useState(false);
  const [siteMemo, setSiteMemo] = useState<SiteMemoReport | undefined>();
  const [copyStatus, setCopyStatus] = useState("");
  const [livePermits, setLivePermits] = useState<LivePermit[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityError, setActivityError] = useState("");
  const [selectedActivityEvent, setSelectedActivityEvent] = useState<ActivityEvent | undefined>();
  const [activityFilters, setActivityFilters] = useState(getDefaultActivityFilters);
  const [activityRadiusFeet, setActivityRadiusFeet] = useState(1200);
  const [permitError, setPermitError] = useState("");
  const [liveZoning, setLiveZoning] = useState<LiveZoning | undefined>();
  const [zoningError, setZoningError] = useState("");
  const [liveParcel, setLiveParcel] = useState<LiveParcel | undefined>();
  const [parcelError, setParcelError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const selectedWatchlistKey = useMemo(
    () => (selectedParcel ? getWatchlistKey(selectedParcel, liveParcel) : undefined),
    [liveParcel, selectedParcel],
  );

  const isSaved = useMemo(
    () =>
      selectedWatchlistKey
        ? savedParcels.some((savedParcel) => savedParcel.id === selectedWatchlistKey)
        : false,
    [savedParcels, selectedWatchlistKey],
  );

  const filteredActivityEvents = useMemo(
    () => activityEvents.filter((event) => activityFilters[event.kind]),
    [activityEvents, activityFilters],
  );

  const activityCounts = useMemo(() => {
    const counts = emptyActivityCounts();
    for (const event of activityEvents) {
      counts[event.kind] += 1;
    }
    return counts;
  }, [activityEvents]);

  const activeActivityFilterCount = useMemo(
    () => ACTIVITY_KIND_ORDER.filter((kind) => activityFilters[kind]).length,
    [activityFilters],
  );

  const visibleSelectedActivityEvent =
    selectedActivityEvent && activityFilters[selectedActivityEvent.kind]
      ? selectedActivityEvent
      : undefined;

  function toggleActivityFilter(kind: ActivityEventKind) {
    setActivityFilters((previous) => ({
      ...previous,
      [kind]: !previous[kind],
    }));
    setSelectedActivityEvent(undefined);
  }

  function chooseActivityRadius(radiusFeet: number) {
    setActivityRadiusFeet(radiusFeet);
    setLivePermits([]);
    setActivityEvents([]);
    setSelectedActivityEvent(undefined);
    setActivityError("");
    setPermitError("");
    setSiteMemo(undefined);
    setCopyStatus("");
  }

  function generateSiteMemo() {
    if (!selectedParcel) return;
    setSiteMemo(
      buildSiteMemoReport(
        selectedParcel,
        liveZoning,
        liveParcel,
        livePermits,
        filteredActivityEvents,
        activityRadiusFeet,
      ),
    );
    setCopyStatus("");
  }

  async function copySiteMemo() {
    if (!siteMemo) return;

    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(siteMemo.plainText);
          copied = true;
        } catch {
          copied = false;
        }
      }

      if (!copied) {
        const textArea = document.createElement("textarea");
        textArea.value = siteMemo.plainText;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  function printSiteMemo() {
    if (!siteMemo) return;
    window.print();
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSiteMemo(undefined);
    setCopyStatus("");
    setSearchError("");
    setIsSearching(true);
    setLivePermits([]);
    setActivityEvents([]);
    setSelectedActivityEvent(undefined);
    setActivityError("");
    setLiveZoning(undefined);
    setLiveParcel(undefined);
    const parcel = matchParcel(query);
    setPermitError("");
    setZoningError("");
    setParcelError("");

    if (parcel) {
      setSelectedParcel(parcel);
      setIsSearching(false);
      return;
    }

    try {
      const pinDigits = query.replace(/\D/g, "");
      if (pinDigits.length >= 10) {
        const pinResponse = await fetch(`/api/parcel?pin=${encodeURIComponent(pinDigits)}`);
        if (pinResponse.ok) {
          const pinData = (await pinResponse.json()) as { parcel: LiveParcel };
          setLiveParcel(pinData.parcel);
          setSelectedParcel(parcelFromLiveParcel(pinData.parcel, query));
          return;
        }
      }

      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("Address lookup failed.");

      const data = (await response.json()) as { results: GeocodeResult[] };
      const result = data.results[0];

      if (!result) {
        setSelectedParcel(undefined);
        setLivePermits([]);
        setActivityEvents([]);
        setSelectedActivityEvent(undefined);
        setActivityError("");
        setLiveZoning(undefined);
        setLiveParcel(undefined);
        setSearchError("No Chicago address match found. Try a fuller street address.");
        return;
      }

      setSelectedParcel(parcelFromGeocode(result, query));
    } catch {
      setSelectedParcel(undefined);
      setLivePermits([]);
      setActivityEvents([]);
      setSelectedActivityEvent(undefined);
      setActivityError("");
      setLiveZoning(undefined);
      setLiveParcel(undefined);
      setSearchError("Address lookup is unavailable right now.");
    } finally {
      setIsSearching(false);
    }
  }

  const selectParcel = useCallback((parcel: Parcel) => {
    setSelectedParcel(parcel);
    setLivePermits([]);
    setActivityEvents([]);
    setSelectedActivityEvent(undefined);
    setActivityError("");
    setLiveZoning(undefined);
    setLiveParcel(undefined);
    setPermitError("");
    setZoningError("");
    setParcelError("");
    setSearchError("");
    setSiteMemo(undefined);
    setCopyStatus("");
  }, []);

  async function toggleSaved() {
    if (!selectedParcel) return;
    if (!isSignedIn) {
      setWatchlistError("Sign in to save parcels to your account.");
      return;
    }

    const current = savedParcelFromCurrent(selectedParcel, liveParcel, liveZoning, livePermits);
    setIsSavingParcel(true);
    setWatchlistError("");

    try {
      if (savedParcels.some((savedParcel) => savedParcel.id === current.id)) {
        const response = await fetch(`/api/watchlist?id=${encodeURIComponent(current.id)}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Unable to remove parcel.");
        setSavedParcels((previous) =>
          previous.filter((savedParcel) => savedParcel.id !== current.id),
        );
        return;
      }

      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current),
      });
      if (!response.ok) throw new Error("Unable to save parcel.");
      const data = (await response.json()) as { item: SavedParcel };
      setSavedParcels((previous) => [
        data.item,
        ...previous.filter((savedParcel) => savedParcel.id !== data.item.id),
      ]);
    } catch {
      setWatchlistError("Account watchlist update failed. Try again.");
    } finally {
      setIsSavingParcel(false);
    }
  }

  async function removeSaved(id: string) {
    if (!isSignedIn) return;
    setWatchlistError("");

    try {
      const response = await fetch(`/api/watchlist?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Unable to remove parcel.");
      setSavedParcels((previous) => previous.filter((savedParcel) => savedParcel.id !== id));
    } catch {
      setWatchlistError("Could not remove that saved parcel.");
    }
  }

  function openSaved(item: SavedParcel) {
    const parcel = parcelFromSaved(item);
    setSelectedParcel(parcel);
    setQuery(item.title);
    setLivePermits([]);
    setActivityEvents([]);
    setSelectedActivityEvent(undefined);
    setActivityError("");
    setLiveZoning(undefined);
    setLiveParcel(undefined);
    setPermitError("");
    setZoningError("");
    setParcelError("");
    setSearchError("");
    setSiteMemo(undefined);
    setCopyStatus("");
  }

  useEffect(() => {
    if (!isAuthLoaded) return;

    if (!isSignedIn) {
      const timer = window.setTimeout(() => {
        setSavedParcels([]);
        setWatchlistReady(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setWatchlistReady(false);
      setWatchlistError("");
    }, 0);

    fetch("/api/watchlist", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load watchlist.");
        return response.json() as Promise<{ items: SavedParcel[] }>;
      })
      .then((data) => setSavedParcels(data.items))
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setSavedParcels([]);
          setWatchlistError("Could not load your account watchlist.");
        }
      })
      .finally(() => setWatchlistReady(true));

    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [isAuthLoaded, isSignedIn]);

  useEffect(() => {
    if (!selectedParcel) return;

    const controller = new AbortController();
    const [lng, lat] = selectedParcel.coordinates;

    fetch(`/api/permits?lat=${lat}&lng=${lng}&radiusFeet=${activityRadiusFeet}&limit=8`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load live permits.");
        return response.json() as Promise<{ permits: LivePermit[] }>;
      })
      .then((data) => setLivePermits(data.permits))
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setLivePermits([]);
          setPermitError("Live permit feed is unavailable right now.");
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [activityRadiusFeet, selectedParcel]);

  useEffect(() => {
    if (!selectedParcel) return;

    const controller = new AbortController();
    const [lng, lat] = selectedParcel.coordinates;

    fetch(`/api/activity?lat=${lat}&lng=${lng}&radiusFeet=${activityRadiusFeet}&limit=50`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load activity.");
        return response.json() as Promise<{ events: ActivityEvent[] }>;
      })
      .then((data) => setActivityEvents(data.events))
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setActivityEvents([]);
          setActivityError("Live approval and activity feed is unavailable right now.");
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [activityRadiusFeet, selectedParcel]);

  useEffect(() => {
    if (!selectedParcel) return;

    const controller = new AbortController();
    const [lng, lat] = selectedParcel.coordinates;

    fetch(`/api/parcel?lat=${lat}&lng=${lng}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load live parcel.");
        return response.json() as Promise<{ parcel: LiveParcel }>;
      })
      .then((data) => setLiveParcel(data.parcel))
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setLiveParcel(undefined);
          setParcelError("Cook County parcel lookup is unavailable right now.");
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [selectedParcel]);

  useEffect(() => {
    if (!selectedParcel) return;

    const controller = new AbortController();
    const [lng, lat] = selectedParcel.coordinates;

    fetch(`/api/zoning?lat=${lat}&lng=${lng}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load live zoning.");
        return response.json() as Promise<LiveZoning>;
      })
      .then((data) => setLiveZoning(data))
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setLiveZoning(undefined);
          setZoningError("Live zoning feed is unavailable right now.");
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [selectedParcel]);

  return (
    <main className="app-shell">
      <section className="map-pane" aria-label="Chicago parcel map">
        <header className="topbar">
          <div>
            <p className="eyebrow">Chicago parcel intelligence</p>
            <h1>ParcelScope</h1>
          </div>
          <form className="search" role="search" onSubmit={handleSearch}>
            <label className="sr-only" htmlFor="searchInput">
              Search address or PIN
            </label>
            <input
              id="searchInput"
              type="search"
              autoComplete="off"
              placeholder="Search address, neighborhood, or PIN"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" disabled={isSearching}>
              {isSearching ? "Searching" : "Search"}
            </button>
          </form>
          <div className="auth-actions">
            {!isSignedIn ? (
              <>
              <SignInButton mode="modal">
                <button className="text-button" type="button">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="icon-button" type="button">
                  Sign up
                </button>
              </SignUpButton>
              </>
            ) : (
              <UserButton />
            )}
          </div>
        </header>

        <ChicagoMap
          selectedParcel={selectedParcel}
          liveParcel={liveParcel}
          activityFilters={activityFilters}
          onSelectParcel={selectParcel}
          onSelectActivity={setSelectedActivityEvent}
        />
      </section>

      <aside className="detail-pane" aria-label="Parcel details">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Selected parcel</p>
            <h2>{selectedParcel?.title ?? "No parcel found"}</h2>
          </div>
          {selectedParcel ? (
            isSignedIn ? (
              <button
                className="icon-button"
                type="button"
                onClick={toggleSaved}
                disabled={isSavingParcel}
              >
                {isSavingParcel ? "Saving" : isSaved ? "Saved" : "Save"}
              </button>
            ) : null
          ) : null}
        </div>

        {!selectedParcel ? (
          <div className="empty-state">
            {searchError || "Search a Chicago address or click any parcel on the map."}
          </div>
        ) : (
          <>
            {searchError ? <p className="error-text">{searchError}</p> : null}
            {isSearching ? <p className="muted">Looking up Chicago address...</p> : null}
            <section className="card watchlist-card">
              <div className="section-line">
                <h3>Watchlist</h3>
                <span>{isSignedIn ? `${savedParcels.length} saved` : "Account required"}</span>
              </div>
              {watchlistError ? <p className="error-text">{watchlistError}</p> : null}
              {!isSignedIn ? (
                <>
                  <p className="muted">
                    Sign in to save parcels to a real database-backed account watchlist.
                  </p>
                  <div className="auth-inline">
                    <SignInButton mode="modal">
                      <button className="icon-button" type="button">
                        Sign in
                      </button>
                    </SignInButton>
                    <SignUpButton mode="modal">
                      <button className="text-button" type="button">
                        Create account
                      </button>
                    </SignUpButton>
                  </div>
                </>
              ) : (
                <>
                {!watchlistReady ? <p className="muted">Loading saved parcels...</p> : null}
                {watchlistReady && savedParcels.length === 0 ? (
                  <p className="muted">Save parcels you want to revisit from any signed-in session.</p>
                ) : null}
                {savedParcels.length > 0 ? (
                  <ol className="watchlist-list">
                    {savedParcels.map((savedParcel) => (
                      <li key={savedParcel.id}>
                        <button
                          className="watchlist-item"
                          type="button"
                          onClick={() => openSaved(savedParcel)}
                        >
                          <strong>{savedParcel.title}</strong>
                          <span>
                            {savedParcel.pin} - {savedParcel.zoningClass} - {savedParcel.lotArea}
                          </span>
                          <small>
                            {savedParcel.permitCount} permits nearby - saved{" "}
                            {formatSavedDate(savedParcel.savedAt)}
                          </small>
                        </button>
                        <button
                          className="text-button danger"
                          type="button"
                          onClick={() => removeSaved(savedParcel.id)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : null}
                </>
              )}
            </section>
            <section className="card">
              <div className="section-line">
                <h3>Parcel Facts</h3>
                <a href={sourceLinks.parcels} target="_blank" rel="noreferrer">
                  Source
                </a>
              </div>
              <dl className="fact-grid">
                <div>
                  <dt>PIN</dt>
                  <dd>{liveParcel?.pin || selectedParcel.pin}</dd>
                </div>
                <div>
                  <dt>Ward</dt>
                  <dd>{liveParcel ? liveParcel.ward || "Unavailable" : selectedParcel.ward}</dd>
                </div>
                <div>
                  <dt>{liveParcel?.municipality ? "Municipality" : "Community area"}</dt>
                  <dd>{liveParcel?.municipality || selectedParcel.community}</dd>
                </div>
                <div>
                  <dt>Lot area</dt>
                  <dd>{liveParcel?.lotArea || selectedParcel.lotArea}</dd>
                </div>
              </dl>
              {liveParcel?.parcelType ? (
                <p className="muted parcel-source-line">
                  Parcel type: {liveParcel.parcelType}. Matched {liveParcel.distanceFeet} ft from
                  search point.
                </p>
              ) : null}
              {parcelError ? <p className="error-text">{parcelError}</p> : null}
            </section>

            <section className="card">
              <div className="section-line">
                <h3>Zoning Snapshot</h3>
                <a href={sourceLinks.zoning} target="_blank" rel="noreferrer">
                  Source
                </a>
              </div>
              <div className="zoning-code">{liveZoning?.zoningClass || selectedParcel.zoning}</div>
              <p>
                {liveZoning?.zoningClass
                  ? "Official Chicago zoning service result for the selected point."
                  : selectedParcel.zoningSummary}
              </p>
              {selectedParcel.source === "geocode" && liveParcel ? (
                <p className="muted">
                  Cook County parcel matched from the geocoded address and outlined on the map.
                </p>
              ) : null}
              {selectedParcel.source === "map" ? (
                <p className="muted">
                  Parcel selected from the live Cook County map layer.
                </p>
              ) : null}
              {selectedParcel.source === "geocode" && !liveParcel ? (
                <p className="muted">
                  Address matched through the City GeoStreets geocoder. Parcel polygon/PIN join is
                  the next ingestion step.
                </p>
              ) : null}
              {zoningError ? <p className="error-text">{zoningError}</p> : null}
              {liveZoning?.ordinanceNumber ? (
                <p className="muted">
                  Ordinance {liveZoning.ordinanceNumber}
                  {liveZoning.ordinanceDate ? ` - ${liveZoning.ordinanceDate}` : ""}
                  {liveZoning.clerkDocument ? ` - ${liveZoning.clerkDocument}` : ""}
                </p>
              ) : null}
              <div className="badges">
                {(liveZoning?.overlays.length
                  ? liveZoning.overlays.map((overlay) => overlay.label)
                  : selectedParcel.badges
                ).map((badge) => (
                  <span className="badge" key={badge}>
                    {badge}
                  </span>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="section-line">
                <h3>Nearby Activity</h3>
                <span>
                  {filteredActivityEvents.length} shown / {activityEvents.length} loaded
                </span>
              </div>
              <div className="activity-controls">
                <div className="filter-row" aria-label="Activity filters">
                  {ACTIVITY_KIND_ORDER.map((kind) => (
                    <button
                      key={kind}
                      className={`filter-chip event-filter-${kind}${
                        activityFilters[kind] ? " active" : ""
                      }`}
                      type="button"
                      aria-pressed={activityFilters[kind]}
                      onClick={() => toggleActivityFilter(kind)}
                    >
                      {ACTIVITY_KIND_LABELS[kind]}
                      <span>{activityCounts[kind]}</span>
                    </button>
                  ))}
                </div>
                <div className="radius-row" aria-label="Activity search radius">
                  {ACTIVITY_RADIUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={activityRadiusFeet === option.value ? "active" : ""}
                      type="button"
                      aria-pressed={activityRadiusFeet === option.value}
                      onClick={() => chooseActivityRadius(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {visibleSelectedActivityEvent ? (
                <div className="selected-activity">
                  <span className={`event-kind event-kind-${visibleSelectedActivityEvent.kind}`}>
                    {formatActivityKind(visibleSelectedActivityEvent)}
                  </span>
                  <strong>{visibleSelectedActivityEvent.title}</strong>
                  <span className="muted">
                    {[visibleSelectedActivityEvent.date, formatDistance(visibleSelectedActivityEvent.distanceFeet)]
                      .filter(Boolean)
                      .join(" - ")}
                  </span>
                  {visibleSelectedActivityEvent.address ? (
                    <p>{visibleSelectedActivityEvent.address}</p>
                  ) : null}
                  {visibleSelectedActivityEvent.description ? (
                    <p className="muted">{visibleSelectedActivityEvent.description}</p>
                  ) : null}
                  <a href={visibleSelectedActivityEvent.sourceUrl} target="_blank" rel="noreferrer">
                    Source: {visibleSelectedActivityEvent.sourceName}
                  </a>
                </div>
              ) : null}
              {activityError ? <p className="error-text">{activityError}</p> : null}
              {!activityError && filteredActivityEvents.length === 0 ? (
                <p className="muted">
                  {activeActivityFilterCount === 0
                    ? "All activity filters are off."
                    : `No matching activity loaded within ${formatActivityRadius(
                        activityRadiusFeet,
                      )}.`}
                </p>
              ) : null}
              <ol className="activity-list">
                {filteredActivityEvents.slice(0, 12).map((event) => (
                  <li key={event.id} className={`activity-item activity-item-${event.kind}`}>
                    <strong>
                      {formatActivityKind(event)}: {event.title}
                    </strong>
                    <span>
                      {[event.date, event.address, formatDistance(event.distanceFeet)]
                        .filter(Boolean)
                        .join(" - ")}{" "}
                      <a href={event.sourceUrl} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    </span>
                    {event.description ? <p>{event.description}</p> : null}
                  </li>
                ))}
              </ol>
            </section>

            <section className="card">
              <div className="section-line">
                <h3>Live Chicago Permits</h3>
                <a href={sourceLinks.permits} target="_blank" rel="noreferrer">
                  Source
                </a>
              </div>
              {permitError ? <p className="error-text">{permitError}</p> : null}
              {!permitError && livePermits.length === 0 ? (
                <p className="muted">
                  No permits loaded yet or none found within {formatActivityRadius(activityRadiusFeet)}.
                </p>
              ) : null}
              <ol className="activity-list">
                {livePermits.map((permit) => (
                  <li key={permit.id}>
                    <strong>
                      {permit.type}: {permit.address || permit.permitNumber}
                    </strong>
                    <span>
                      {permit.issueDate?.slice(0, 10) || "Unknown date"} -{" "}
                      {permit.reviewType || "Review type unavailable"} -{" "}
                      <a href={permit.sourceUrl} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    </span>
                    {permit.description ? <p>{permit.description}</p> : null}
                  </li>
                ))}
              </ol>
            </section>

            <section className="card printable-report-card">
              <div className="section-line report-title-row">
                <div>
                  <h3>Source-Linked Site Memo</h3>
                  <p className="muted">
                    Generates a client-ready parcel snapshot with citations.
                  </p>
                </div>
                <button type="button" onClick={generateSiteMemo}>
                  Generate report
                </button>
              </div>

              {siteMemo ? (
                <>
                  <div className="report-actions">
                    <button type="button" onClick={copySiteMemo}>
                      Copy text
                    </button>
                    <button type="button" onClick={printSiteMemo}>
                      Print / save PDF
                    </button>
                    {copyStatus ? <span>{copyStatus}</span> : null}
                  </div>

                  <article className="site-report" aria-label="Generated site memo">
                    <header className="report-cover">
                      <p className="eyebrow">ParcelScope site memo</p>
                      <h2>{siteMemo.title}</h2>
                      <p>{siteMemo.subtitle}</p>
                      <span>Generated {siteMemo.generatedLabel}</span>
                    </header>

                    <section className="report-section">
                      <h4>Executive Summary</h4>
                      <p>{siteMemo.summary}</p>
                    </section>

                    <section className="report-section">
                      <h4>Parcel Facts</h4>
                      <dl className="report-facts">
                        {siteMemo.parcelFacts.map((fact) => (
                          <div key={fact.label}>
                            <dt>{fact.label}</dt>
                            <dd>
                              {fact.value}{" "}
                              <a href={citationUrl(siteMemo, fact.citationId)} target="_blank" rel="noreferrer">
                                [{fact.citationId}]
                              </a>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    <section className="report-section">
                      <h4>Zoning And Overlays</h4>
                      <dl className="report-facts">
                        {siteMemo.zoningFacts.map((fact) => (
                          <div key={fact.label}>
                            <dt>{fact.label}</dt>
                            <dd>
                              {fact.value}{" "}
                              <a href={citationUrl(siteMemo, fact.citationId)} target="_blank" rel="noreferrer">
                                [{fact.citationId}]
                              </a>
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <div className="report-badges">
                        {siteMemo.overlays.length ? (
                          siteMemo.overlays.map((overlay) => <span key={overlay}>{overlay}</span>)
                        ) : (
                          <span>No overlay flags loaded</span>
                        )}
                      </div>
                    </section>

                    <section className="report-section">
                      <h4>Nearby Activity</h4>
                      {siteMemo.activityItems.length ? (
                        <ol className="report-records">
                          {siteMemo.activityItems.map((item) => (
                            <li key={`${item.title}-${item.meta}`}>
                              <strong>{item.title}</strong>
                              <span>
                                {item.meta}{" "}
                                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                  [{item.citationId}]
                                </a>
                              </span>
                              {item.description ? <p>{item.description}</p> : null}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="muted">No matching approval, demolition, ZBA, or PD signals loaded.</p>
                      )}
                    </section>

                    <section className="report-section">
                      <h4>Permit Feed</h4>
                      {siteMemo.permitItems.length ? (
                        <ol className="report-records">
                          {siteMemo.permitItems.map((item) => (
                            <li key={`${item.title}-${item.meta}`}>
                              <strong>{item.title}</strong>
                              <span>
                                {item.meta}{" "}
                                <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                                  [{item.citationId}]
                                </a>
                              </span>
                              {item.description ? <p>{item.description}</p> : null}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="muted">No permit records loaded in the selected radius.</p>
                      )}
                    </section>

                    <section className="report-section">
                      <h4>Manual Verification</h4>
                      <ul className="report-checklist">
                        {siteMemo.verificationItems.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>

                    <section className="report-section">
                      <h4>Sources</h4>
                      <ol className="report-sources">
                        {siteMemo.citations.map((citation) => (
                          <li key={citation.id}>
                            <a href={citation.url} target="_blank" rel="noreferrer">
                              [{citation.id}] {citation.label}
                            </a>
                            <span>{citation.note}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  </article>
                </>
              ) : (
                <div className="memo-output">
                  Generate a first-pass report from parcel facts, zoning flags, nearby activity,
                  and source citations.
                </div>
              )}
            </section>
          </>
        )}
      </aside>
    </main>
  );
}
