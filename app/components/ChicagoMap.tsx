"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MapLibreMap, Marker } from "maplibre-gl";
import { Parcel, parcels } from "../data/sampleParcels";
import { LivePermit } from "../data/livePermits";

type ChicagoMapProps = {
  selectedParcel?: Parcel;
  livePermits: LivePermit[];
  onSelectParcel: (parcel: Parcel) => void;
};

export default function ChicagoMap({ selectedParcel, livePermits, onSelectParcel }: ChicagoMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());
  const searchMarkerRef = useRef<Marker | null>(null);
  const permitMarkersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-87.6298, 41.8781],
      zoom: 11.2,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const markers = new globalThis.Map<string, Marker>();

    parcels.forEach((parcel) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "map-marker";
      element.setAttribute("aria-label", `Open parcel ${parcel.title}`);
      element.addEventListener("click", () => onSelectParcel(parcel));

      const marker = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat(parcel.coordinates)
        .addTo(map);
      markers.set(parcel.id, marker);
    });

    const approvalPoints = [
      { label: "PD", coordinates: [-87.6529, 41.8845] as [number, number] },
      { label: "ZBA", coordinates: [-87.645, 41.9378] as [number, number] },
      { label: "Demo", coordinates: [-87.626, 41.8498] as [number, number] },
      { label: "Permit", coordinates: [-87.6175, 41.861] as [number, number] },
    ];

    approvalPoints.forEach((point) => {
      const element = document.createElement("div");
      element.className = "approval-marker";
      element.textContent = point.label;
      new maplibregl.Marker({ element, anchor: "center" }).setLngLat(point.coordinates).addTo(map);
    });

    mapRef.current = map;
    markersRef.current = markers;

    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
      markersRef.current = new globalThis.Map<string, Marker>();
      searchMarkerRef.current = null;
    };
  }, [onSelectParcel]);

  useEffect(() => {
    markersRef.current.forEach((marker, parcelId) => {
      marker.getElement().classList.toggle("active", parcelId === selectedParcel?.id);
    });

    if (selectedParcel && mapRef.current) {
      if (selectedParcel.source === "geocode") {
        searchMarkerRef.current?.remove();

        const element = document.createElement("div");
        element.className = "search-marker";
        element.textContent = "S";
        searchMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(selectedParcel.coordinates)
          .addTo(mapRef.current);
      } else {
        searchMarkerRef.current?.remove();
        searchMarkerRef.current = null;
      }

      mapRef.current.flyTo({
        center: selectedParcel.coordinates,
        zoom: 14,
        essential: true,
      });
    }
  }, [selectedParcel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    permitMarkersRef.current.forEach((marker) => marker.remove());
    permitMarkersRef.current = livePermits.map((permit) => {
      const element = document.createElement("a");
      element.className = "permit-marker";
      element.href = permit.sourceUrl;
      element.target = "_blank";
      element.rel = "noreferrer";
      element.setAttribute("aria-label", `Open permit ${permit.permitNumber}`);
      element.textContent = "P";

      return new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat(permit.coordinates)
        .addTo(map);
    });

    return () => {
      permitMarkersRef.current.forEach((marker) => marker.remove());
      permitMarkersRef.current = [];
    };
  }, [livePermits]);

  return (
    <div className="real-map-shell">
      <div ref={containerRef} className="real-map" />
      <div className="map-legend">
        <span>
          <i className="legend-pin" />
          Parcel
        </span>
        <span>
          <i className="legend-approval" />
          Approval activity
        </span>
        <span>
          <i className="legend-permit" />
          Live permits
        </span>
        <span>
          <i className="legend-search" />
          Address result
        </span>
      </div>
    </div>
  );
}
