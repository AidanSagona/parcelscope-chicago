"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { GeocodeResult } from "../data/geocode";
import { LiveParcel } from "../data/liveParcel";
import { Parcel, parcels, sourceLinks } from "../data/sampleParcels";
import { LivePermit } from "../data/livePermits";
import { LiveZoning } from "../data/liveZoning";

const ChicagoMap = dynamic(() => import("./ChicagoMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading Chicago map...</div>,
});

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
      "This is a geocoded address point. Zoning and permits are live; parcel boundary and PIN join are a later data-ingestion step.",
    badges: ["Live address lookup"],
    activity: [],
    coordinates: result.coordinates,
    source: "geocode",
  };
}

function buildMemo(parcel: Parcel, liveZoning?: LiveZoning, liveParcel?: LiveParcel) {
  const activitySummary = parcel.activity
    .map((item) => `- ${item.type}: ${item.title} (${item.date}, ${item.distance})`)
    .join("\n");
  const zoningClass = liveZoning?.zoningClass || parcel.zoning;
  const pin = liveParcel?.pin || parcel.pin;
  const ward = liveParcel?.ward || parcel.ward;
  const lotArea = liveParcel?.lotArea || parcel.lotArea;
  const overlaySummary =
    liveZoning?.overlays.length ? liveZoning.overlays.map((overlay) => overlay.label).join(", ") : "None loaded";

  return `${parcel.title}

First-pass summary:
The selected parcel is identified as PIN ${pin} in Ward ${ward}, ${parcel.community}. Lot area is ${lotArea}. The current zoning snapshot is ${zoningClass}. Applicable live overlay flags: ${overlaySummary}.

Nearby approval and permit signals:
${activitySummary}

Manual verification checklist:
- Confirm current zoning and overlays against the City Zoning_update service.
- Confirm permit records against the Chicago Building Permits dataset.
- Confirm discretionary actions against Plan Commission, ZBA, and City Clerk records.

This draft is an informational triage memo, not a legal zoning opinion.`;
}

export default function ParcelApp() {
  const [selectedParcel, setSelectedParcel] = useState<Parcel | undefined>(parcels[0]);
  const [query, setQuery] = useState("");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [memo, setMemo] = useState("");
  const [livePermits, setLivePermits] = useState<LivePermit[]>([]);
  const [permitError, setPermitError] = useState("");
  const [liveZoning, setLiveZoning] = useState<LiveZoning | undefined>();
  const [zoningError, setZoningError] = useState("");
  const [liveParcel, setLiveParcel] = useState<LiveParcel | undefined>();
  const [parcelError, setParcelError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const isSaved = useMemo(
    () => (selectedParcel ? savedIds.has(selectedParcel.id) : false),
    [savedIds, selectedParcel],
  );

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMemo("");
    setSearchError("");
    setIsSearching(true);
    setLivePermits([]);
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
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("Address lookup failed.");

      const data = (await response.json()) as { results: GeocodeResult[] };
      const result = data.results[0];

      if (!result) {
        setSelectedParcel(undefined);
        setLivePermits([]);
        setLiveZoning(undefined);
        setLiveParcel(undefined);
        setSearchError("No Chicago address match found. Try a fuller street address.");
        return;
      }

      setSelectedParcel(parcelFromGeocode(result, query));
    } catch {
      setSelectedParcel(undefined);
      setLivePermits([]);
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
    setLiveZoning(undefined);
    setLiveParcel(undefined);
    setPermitError("");
    setZoningError("");
    setParcelError("");
    setSearchError("");
    setMemo("");
  }, []);

  function toggleSaved() {
    if (!selectedParcel) return;
    const nextSaved = new Set(savedIds);
    if (nextSaved.has(selectedParcel.id)) nextSaved.delete(selectedParcel.id);
    else nextSaved.add(selectedParcel.id);
    setSavedIds(nextSaved);
  }

  useEffect(() => {
    if (!selectedParcel) return;

    const controller = new AbortController();
    const [lng, lat] = selectedParcel.coordinates;

    fetch(`/api/permits?lat=${lat}&lng=${lng}&radiusFeet=1200&limit=8`, {
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
  }, [selectedParcel]);

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
        </header>

        <ChicagoMap
          selectedParcel={selectedParcel}
          liveParcel={liveParcel}
          livePermits={livePermits}
          onSelectParcel={selectParcel}
        />
      </section>

      <aside className="detail-pane" aria-label="Parcel details">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Selected parcel</p>
            <h2>{selectedParcel?.title ?? "No parcel found"}</h2>
          </div>
          {selectedParcel ? (
            <button className="icon-button" type="button" onClick={toggleSaved}>
              {isSaved ? "Saved" : "Save"}
            </button>
          ) : null}
        </div>

        {!selectedParcel ? (
          <div className="empty-state">
            {searchError || "Search a Chicago address, sample site, or sample PIN."}
          </div>
        ) : (
          <>
            {searchError ? <p className="error-text">{searchError}</p> : null}
            {isSearching ? <p className="muted">Looking up Chicago address...</p> : null}
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
                <h3>Sample Activity</h3>
                <span>500 ft</span>
              </div>
              <ol className="activity-list">
                {selectedParcel.activity.map((item) => (
                  <li key={`${item.type}-${item.title}`}>
                    <strong>
                      {item.type}: {item.title}
                    </strong>
                    <span>
                      {item.date} - {item.distance} -{" "}
                      <a href={item.url} target="_blank" rel="noreferrer">
                        Source
                      </a>
                    </span>
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
                <p className="muted">No permits loaded yet or none found within 1,200 feet.</p>
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

            <section className="card">
              <div className="section-line">
                <h3>Site Memo Draft</h3>
                <button
                  type="button"
                  onClick={() => setMemo(buildMemo(selectedParcel, liveZoning, liveParcel))}
                >
                  Generate
                </button>
              </div>
              <div className="memo-output">
                {memo ||
                  "Generate a first-pass memo from parcel facts, zoning flags, and nearby activity."}
              </div>
            </section>
          </>
        )}
      </aside>
    </main>
  );
}
