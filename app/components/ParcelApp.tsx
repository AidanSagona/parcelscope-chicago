"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Parcel, parcels, sourceLinks } from "../data/sampleParcels";
import { LivePermit } from "../data/livePermits";

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

function buildMemo(parcel: Parcel) {
  const activitySummary = parcel.activity
    .map((item) => `- ${item.type}: ${item.title} (${item.date}, ${item.distance})`)
    .join("\n");

  return `${parcel.title}

First-pass summary:
The selected parcel is identified as PIN ${parcel.pin} in Ward ${parcel.ward}, ${parcel.community}. The current sample zoning snapshot is ${parcel.zoning}. Applicable phase-1 flags: ${parcel.badges.join(", ")}.

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

  const isSaved = useMemo(
    () => (selectedParcel ? savedIds.has(selectedParcel.id) : false),
    [savedIds, selectedParcel],
  );

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMemo("");
    const parcel = matchParcel(query);
    setSelectedParcel(parcel);
    if (!parcel) setLivePermits([]);
    setPermitError("");
  }

  function selectParcel(parcel: Parcel) {
    setSelectedParcel(parcel);
    setLivePermits([]);
    setPermitError("");
    setMemo("");
  }

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
            <button type="submit">Search</button>
          </form>
        </header>

        <ChicagoMap
          selectedParcel={selectedParcel}
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
            No matching parcel in this phase-1 sample. Try Fulton, Clark, Michigan, or a sample
            PIN.
          </div>
        ) : (
          <>
            <section className="card">
              <h3>Parcel Facts</h3>
              <dl className="fact-grid">
                <div>
                  <dt>PIN</dt>
                  <dd>{selectedParcel.pin}</dd>
                </div>
                <div>
                  <dt>Ward</dt>
                  <dd>{selectedParcel.ward}</dd>
                </div>
                <div>
                  <dt>Community area</dt>
                  <dd>{selectedParcel.community}</dd>
                </div>
                <div>
                  <dt>Lot area</dt>
                  <dd>{selectedParcel.lotArea}</dd>
                </div>
              </dl>
            </section>

            <section className="card">
              <div className="section-line">
                <h3>Zoning Snapshot</h3>
                <a href={sourceLinks.zoning} target="_blank" rel="noreferrer">
                  Source
                </a>
              </div>
              <div className="zoning-code">{selectedParcel.zoning}</div>
              <p>{selectedParcel.zoningSummary}</p>
              <div className="badges">
                {selectedParcel.badges.map((badge) => (
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
                <button type="button" onClick={() => setMemo(buildMemo(selectedParcel))}>
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
