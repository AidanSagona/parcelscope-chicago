"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, {
  Map as MapLibreMap,
  Marker,
  type FilterSpecification,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type {
  ActivityEvent,
  ActivityFilterState,
  ActivityEventFeatureCollection,
  ActivityEventProperties,
} from "../data/activityEvents";
import type { LiveParcel } from "../data/liveParcel";
import type { MapParcelFeatureCollection, MapParcelProperties } from "../data/mapParcels";
import type { Parcel } from "../data/sampleParcels";

type ChicagoMapProps = {
  selectedParcel?: Parcel;
  liveParcel?: LiveParcel;
  activityFilters: ActivityFilterState;
  onSelectParcel: (parcel: Parcel) => void;
  onSelectActivity: (event: ActivityEvent) => void;
};

type MutableGeoJsonSource = {
  setData: (
    data:
      | Feature<Polygon>
      | FeatureCollection<Polygon, MapParcelProperties>
      | ActivityEventFeatureCollection
  ) => void;
};

type ParcelMapResponse = {
  parcels: MapParcelFeatureCollection;
  count: number;
  needsZoom?: boolean;
  exceededTransferLimit?: boolean;
};

type ActivityMapResponse = {
  geojson: ActivityEventFeatureCollection;
  count: number;
  needsZoom?: boolean;
};

const VIEWPORT_PARCELS_SOURCE_ID = "viewport-parcels-source";
const VIEWPORT_PARCELS_FILL_LAYER_ID = "viewport-parcels-fill";
const VIEWPORT_PARCELS_LINE_LAYER_ID = "viewport-parcels-line";
const VIEWPORT_PARCELS_SELECTED_FILL_LAYER_ID = "viewport-parcels-selected-fill";
const VIEWPORT_PARCELS_SELECTED_LINE_LAYER_ID = "viewport-parcels-selected-line";
const ACTIVITY_SOURCE_ID = "activity-events-source";
const ACTIVITY_CIRCLE_LAYER_ID = "activity-events-circle";
const PARCEL_SOURCE_ID = "selected-parcel-source";
const PARCEL_FILL_LAYER_ID = "selected-parcel-fill";
const PARCEL_LINE_LAYER_ID = "selected-parcel-line";
const PARCEL_MIN_ZOOM = 13.25;
const ACTIVITY_MIN_ZOOM = 12.25;
const EMPTY_PARCELS: MapParcelFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
const EMPTY_ACTIVITY: ActivityEventFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const CHICAGO_BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    cartoLight: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    {
      id: "carto-light",
      type: "raster",
      source: "cartoLight",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

function selectedParcelFilter(selectedParcel?: Parcel) {
  return ["==", ["get", "id"], selectedParcel?.id || ""] as FilterSpecification;
}

function activityLayerFilter(activityFilters: ActivityFilterState) {
  const enabledKinds = Object.entries(activityFilters)
    .filter(([, isEnabled]) => isEnabled)
    .map(([kind]) => kind);

  if (enabledKinds.length === 0) {
    return ["==", ["get", "kind"], "__none__"] as FilterSpecification;
  }

  return ["match", ["get", "kind"], enabledKinds, true, false] as FilterSpecification;
}

function trimCache<T>(cache: Map<string, T>, maxEntries = 12) {
  if (cache.size <= maxEntries) return;
  const oldestKey = cache.keys().next().value as string | undefined;
  if (oldestKey) cache.delete(oldestKey);
}

function parcelStatusFromResponse(data: ParcelMapResponse) {
  if (data.needsZoom) return "Zoom in closer to load individual parcels.";
  if (data.count === 0) return "No parcels returned for this view.";
  if (data.exceededTransferLimit) {
    return `${data.count.toLocaleString()} parcels loaded. Zoom in for more detail.`;
  }
  return `${data.count.toLocaleString()} live Cook County parcels loaded.`;
}

function activityStatusFromResponse(data: ActivityMapResponse) {
  if (data.needsZoom) return "Zoom in closer to load approval and permit activity.";
  if (data.count === 0) return "No activity signals returned for this view.";
  return `${data.count.toLocaleString()} approval, permit, and demo signals loaded.`;
}

function mapFeatureToParcel(feature: MapGeoJSONFeature): Parcel | undefined {
  const properties = feature.properties as Partial<MapParcelProperties> | null;
  if (!properties?.id || !properties.pin || !properties.centerLng || !properties.centerLat) {
    return undefined;
  }

  return {
    id: properties.id,
    title: `Parcel ${properties.pin}`,
    pin: properties.pin,
    aliases: [properties.pin, properties.rawPin || "", properties.pin10 || ""].filter(Boolean),
    ward: properties.ward || "Unavailable",
    community: properties.municipality || "Chicago",
    lotArea: properties.lotArea || "Unavailable",
    zoning: "Live lookup",
    zoningSummary:
      "Cook County parcel selected from the live map. Zoning, overlays, and permits refresh from official feeds.",
    badges: ["Cook County parcel"],
    activity: [],
    coordinates: [properties.centerLng, properties.centerLat],
    source: "map",
  };
}

function mapFeatureToActivity(feature: MapGeoJSONFeature): ActivityEvent | undefined {
  const properties = feature.properties as Partial<ActivityEventProperties> | null;
  if (
    !properties?.id ||
    !properties.kind ||
    !properties.label ||
    !properties.title ||
    !properties.sourceName ||
    !properties.sourceUrl ||
    !Number.isFinite(Number(properties.lng)) ||
    !Number.isFinite(Number(properties.lat))
  ) {
    return undefined;
  }

  return {
    id: properties.id,
    kind: properties.kind,
    label: properties.label,
    title: properties.title,
    date: properties.date,
    address: properties.address,
    description: properties.description,
    distanceFeet: Number.isFinite(Number(properties.distanceFeet))
      ? Number(properties.distanceFeet)
      : undefined,
    coordinates: [Number(properties.lng), Number(properties.lat)],
    sourceName: properties.sourceName,
    sourceUrl: properties.sourceUrl,
  };
}

export default function ChicagoMap({
  selectedParcel,
  liveParcel,
  activityFilters,
  onSelectParcel,
  onSelectActivity,
}: ChicagoMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const searchMarkerRef = useRef<Marker | null>(null);
  const initialCenterRef = useRef<[number, number]>(selectedParcel?.coordinates || [-87.6582, 41.8868]);
  const initialSelectedFilterRef = useRef(selectedParcelFilter(selectedParcel));
  const initialActivityFilterRef = useRef(activityLayerFilter(activityFilters));
  const [parcelStatus, setParcelStatus] = useState("Loading parcel boundaries...");
  const [activityStatus, setActivityStatus] = useState("Loading approvals and activity...");

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: CHICAGO_BASEMAP_STYLE,
      center: initialCenterRef.current,
      zoom: 15.25,
      attributionControl: false,
    });

    let latestRequestId = 0;
    let latestActivityRequestId = 0;
    let parcelController: AbortController | null = null;
    let activityController: AbortController | null = null;
    const parcelCache = new Map<string, ParcelMapResponse>();
    const activityCache = new Map<string, ActivityMapResponse>();

    function currentViewportKey() {
      const bounds = map.getBounds();
      const precision = 10000;
      const bbox = [
        Math.floor(bounds.getWest() * precision) / precision,
        Math.floor(bounds.getSouth() * precision) / precision,
        Math.ceil(bounds.getEast() * precision) / precision,
        Math.ceil(bounds.getNorth() * precision) / precision,
      ].join(",");
      const zoomBucket = Math.floor(map.getZoom() * 2) / 2;

      return {
        bbox,
        key: `${zoomBucket}:${bbox}`,
      };
    }

    async function loadViewportParcels() {
      const source = map.getSource(VIEWPORT_PARCELS_SOURCE_ID) as MutableGeoJsonSource | undefined;
      if (!source) return;

      if (map.getZoom() < PARCEL_MIN_ZOOM) {
        parcelController?.abort();
        source.setData(EMPTY_PARCELS);
        setParcelStatus("Zoom in to load Cook County parcel boundaries.");
        return;
      }

      const requestId = latestRequestId + 1;
      latestRequestId = requestId;
      parcelController?.abort();
      const viewport = currentViewportKey();
      const cached = parcelCache.get(viewport.key);
      if (cached) {
        source.setData(cached.parcels);
        setParcelStatus(parcelStatusFromResponse(cached));
        return;
      }

      parcelController = new AbortController();
      setParcelStatus("Loading parcel boundaries...");

      try {
        const response = await fetch(
          `/api/parcels?bbox=${encodeURIComponent(viewport.bbox)}&limit=700`,
          {
            signal: parcelController.signal,
          },
        );
        if (!response.ok) throw new Error("Parcel map request failed.");

        const data = (await response.json()) as ParcelMapResponse;
        if (requestId !== latestRequestId) return;

        source.setData(data.parcels);
        parcelCache.set(viewport.key, data);
        trimCache(parcelCache);
        setParcelStatus(parcelStatusFromResponse(data));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (requestId === latestRequestId) {
          source.setData(EMPTY_PARCELS);
          setParcelStatus("Parcel map feed is unavailable right now.");
        }
      }
    }

    async function loadViewportActivity() {
      const source = map.getSource(ACTIVITY_SOURCE_ID) as MutableGeoJsonSource | undefined;
      if (!source) return;

      if (map.getZoom() < ACTIVITY_MIN_ZOOM) {
        activityController?.abort();
        source.setData(EMPTY_ACTIVITY);
        setActivityStatus("Zoom in to load permits, demolitions, ZBA cases, and PDs.");
        return;
      }

      const requestId = latestActivityRequestId + 1;
      latestActivityRequestId = requestId;
      activityController?.abort();
      const viewport = currentViewportKey();
      const cached = activityCache.get(viewport.key);
      if (cached) {
        source.setData(cached.geojson);
        setActivityStatus(activityStatusFromResponse(cached));
        return;
      }

      activityController = new AbortController();
      setActivityStatus("Loading approvals and activity...");

      try {
        const response = await fetch(
          `/api/activity?bbox=${encodeURIComponent(viewport.bbox)}&limit=120`,
          {
            signal: activityController.signal,
          },
        );
        if (!response.ok) throw new Error("Activity map request failed.");

        const data = (await response.json()) as ActivityMapResponse;
        if (requestId !== latestActivityRequestId) return;

        source.setData(data.geojson);
        activityCache.set(viewport.key, data);
        trimCache(activityCache);
        setActivityStatus(activityStatusFromResponse(data));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        if (requestId === latestActivityRequestId) {
          source.setData(EMPTY_ACTIVITY);
          setActivityStatus("Activity feed is unavailable right now.");
        }
      }
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.once("load", () => {
      map.addSource(VIEWPORT_PARCELS_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_PARCELS,
      });

      map.addLayer({
        id: VIEWPORT_PARCELS_FILL_LAYER_ID,
        type: "fill",
        source: VIEWPORT_PARCELS_SOURCE_ID,
        paint: {
          "fill-color": "#1e7a54",
          "fill-opacity": 0.12,
        },
      });

      map.addLayer({
        id: VIEWPORT_PARCELS_LINE_LAYER_ID,
        type: "line",
        source: VIEWPORT_PARCELS_SOURCE_ID,
        paint: {
          "line-color": "#245c48",
          "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.45, 16, 1.25],
        },
      });

      map.addLayer({
        id: VIEWPORT_PARCELS_SELECTED_FILL_LAYER_ID,
        type: "fill",
        source: VIEWPORT_PARCELS_SOURCE_ID,
        filter: initialSelectedFilterRef.current,
        paint: {
          "fill-color": "#176f4d",
          "fill-opacity": 0.32,
        },
      });

      map.addLayer({
        id: VIEWPORT_PARCELS_SELECTED_LINE_LAYER_ID,
        type: "line",
        source: VIEWPORT_PARCELS_SOURCE_ID,
        filter: initialSelectedFilterRef.current,
        paint: {
          "line-color": "#0c3b2a",
          "line-width": 3,
        },
      });

      map.addSource(ACTIVITY_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_ACTIVITY,
      });

      map.addLayer({
        id: ACTIVITY_CIRCLE_LAYER_ID,
        type: "circle",
        source: ACTIVITY_SOURCE_ID,
        filter: initialActivityFilterRef.current,
        paint: {
          "circle-color": [
            "match",
            ["get", "kind"],
            "permit",
            "#215f9a",
            "demo",
            "#9a2f22",
            "zba",
            "#6b4fb3",
            "planned-development",
            "#a56812",
            "#33443c",
          ],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 4, 15, 7, 17, 10],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 0.92,
        },
      });

      map.on("click", VIEWPORT_PARCELS_FILL_LAYER_ID, (event) => {
        const parcel = event.features?.[0] ? mapFeatureToParcel(event.features[0]) : undefined;
        if (parcel) onSelectParcel(parcel);
      });

      map.on("click", ACTIVITY_CIRCLE_LAYER_ID, (event) => {
        const activity = event.features?.[0] ? mapFeatureToActivity(event.features[0]) : undefined;
        if (activity) onSelectActivity(activity);
      });

      map.on("mouseenter", VIEWPORT_PARCELS_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", VIEWPORT_PARCELS_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("mouseenter", ACTIVITY_CIRCLE_LAYER_ID, () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", ACTIVITY_CIRCLE_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("moveend", () => {
        void loadViewportParcels();
        void loadViewportActivity();
      });
      map.resize();
      void loadViewportParcels();
      void loadViewportActivity();
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);
    requestAnimationFrame(() => map.resize());
    window.setTimeout(() => map.resize(), 250);

    return () => {
      parcelController?.abort();
      activityController?.abort();
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      searchMarkerRef.current = null;
    };
  }, [onSelectActivity, onSelectParcel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.getLayer(VIEWPORT_PARCELS_SELECTED_FILL_LAYER_ID)) {
      map.setFilter(VIEWPORT_PARCELS_SELECTED_FILL_LAYER_ID, selectedParcelFilter(selectedParcel));
    }

    if (map.getLayer(VIEWPORT_PARCELS_SELECTED_LINE_LAYER_ID)) {
      map.setFilter(VIEWPORT_PARCELS_SELECTED_LINE_LAYER_ID, selectedParcelFilter(selectedParcel));
    }

    if (selectedParcel) {
      if (selectedParcel.source === "geocode") {
        searchMarkerRef.current?.remove();

        const element = document.createElement("div");
        element.className = "search-marker";
        element.textContent = "S";
        searchMarkerRef.current = new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(selectedParcel.coordinates)
          .addTo(map);
      } else {
        searchMarkerRef.current?.remove();
        searchMarkerRef.current = null;
      }

      map.flyTo({
        center: selectedParcel.coordinates,
        zoom: Math.max(map.getZoom(), 15.5),
        essential: true,
      });
    }
  }, [selectedParcel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(ACTIVITY_CIRCLE_LAYER_ID)) return;
    map.setFilter(ACTIVITY_CIRCLE_LAYER_ID, activityLayerFilter(activityFilters));
  }, [activityFilters]);

  useEffect(() => {
    const activeMap = mapRef.current;
    if (!activeMap) return;
    const mapInstance: MapLibreMap = activeMap;

    function removeBoundary() {
      if (mapInstance.getLayer(PARCEL_LINE_LAYER_ID)) mapInstance.removeLayer(PARCEL_LINE_LAYER_ID);
      if (mapInstance.getLayer(PARCEL_FILL_LAYER_ID)) mapInstance.removeLayer(PARCEL_FILL_LAYER_ID);
      if (mapInstance.getSource(PARCEL_SOURCE_ID)) mapInstance.removeSource(PARCEL_SOURCE_ID);
    }

    function upsertBoundary() {
      if (!liveParcel?.geometry) {
        removeBoundary();
        return;
      }

      const feature: Feature<Polygon> = {
        type: "Feature",
        properties: {
          pin: liveParcel.pin,
        },
        geometry: liveParcel.geometry,
      };

      const existingSource = mapInstance.getSource(PARCEL_SOURCE_ID) as
        | MutableGeoJsonSource
        | undefined;

      if (existingSource) {
        existingSource.setData(feature);
        return;
      }

      mapInstance.addSource(PARCEL_SOURCE_ID, {
        type: "geojson",
        data: feature,
      });
      mapInstance.addLayer({
        id: PARCEL_FILL_LAYER_ID,
        type: "fill",
        source: PARCEL_SOURCE_ID,
        paint: {
          "fill-color": "#176f4d",
          "fill-opacity": 0.22,
        },
      });
      mapInstance.addLayer({
        id: PARCEL_LINE_LAYER_ID,
        type: "line",
        source: PARCEL_SOURCE_ID,
        paint: {
          "line-color": "#0c3b2a",
          "line-width": 4,
        },
      });
    }

    if (mapInstance.isStyleLoaded()) upsertBoundary();
    else mapInstance.once("load", upsertBoundary);
  }, [liveParcel]);

  return (
    <div className="real-map-shell">
      <div ref={containerRef} className="real-map" />
      <div className="map-status-stack">
        <div className="parcel-map-status">{parcelStatus}</div>
        <div className="parcel-map-status activity-map-status">{activityStatus}</div>
      </div>
      <div className="map-legend">
        <span>
          <i className="legend-parcels" />
          Parcel boundaries
        </span>
        <span>
          <i className="legend-selected" />
          Selected parcel
        </span>
        <span>
          <i className="legend-permit" />
          Permits
        </span>
        <span>
          <i className="legend-demo" />
          Demos
        </span>
        <span>
          <i className="legend-zba" />
          ZBA
        </span>
        <span>
          <i className="legend-pd" />
          PDs
        </span>
        <span>
          <i className="legend-search" />
          Address result
        </span>
      </div>
    </div>
  );
}
