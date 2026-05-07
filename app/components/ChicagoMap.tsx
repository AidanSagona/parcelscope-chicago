"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MapLibreMap, Marker } from "maplibre-gl";
import { Parcel, parcels } from "../data/sampleParcels";

type ChicagoMapProps = {
  selectedParcel?: Parcel;
  onSelectParcel: (parcel: Parcel) => void;
};

export default function ChicagoMap({ selectedParcel, onSelectParcel }: ChicagoMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());

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
    };
  }, [onSelectParcel]);

  useEffect(() => {
    markersRef.current.forEach((marker, parcelId) => {
      marker.getElement().classList.toggle("active", parcelId === selectedParcel?.id);
    });

    if (selectedParcel && mapRef.current) {
      mapRef.current.flyTo({
        center: selectedParcel.coordinates,
        zoom: 14,
        essential: true,
      });
    }
  }, [selectedParcel]);

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
      </div>
    </div>
  );
}
