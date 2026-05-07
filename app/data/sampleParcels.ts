export type Activity = {
  type: "Plan Commission" | "Permit" | "ZBA" | "Demo";
  title: string;
  date: string;
  distance: string;
  url: string;
};

export type Parcel = {
  id: string;
  title: string;
  pin: string;
  aliases: string[];
  ward: string;
  community: string;
  lotArea: string;
  zoning: string;
  zoningSummary: string;
  badges: string[];
  activity: Activity[];
  coordinates: [number, number];
  source: "sample" | "geocode";
};

export const sourceLinks = {
  geocoder:
    "https://gisapps.chicago.gov/arcgis/rest/services/GeoStreets/GeocodeServer/findAddressCandidates",
  zoning:
    "https://gisapps.cityofchicago.org/arcgis/rest/services/ExternalApps/Zoning_update/MapServer/0",
  permits: "https://data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu",
  planCommission:
    "https://www.chicago.gov/city/en/depts/dcd/supp_info/chicago_plan_commission.html",
  zba: "https://www.chicago.gov/city/en/depts/dcd/supp_info/zoning_board_of_appeals.html",
};

export const parcels: Parcel[] = [
  {
    id: "p1",
    title: "1250 W Fulton Market",
    pin: "17-08-123-045-0000",
    aliases: ["fulton", "1250 w fulton", "17-08-123"],
    ward: "27",
    community: "Near West Side",
    lotArea: "21,600 sq ft",
    zoning: "DX-5",
    zoningSummary:
      "Downtown mixed-use district. Phase 1 treats district rules as source-linked reference data, not a legal zoning opinion.",
    badges: ["ARO area", "Downtown area", "Pedestrian street nearby"],
    coordinates: [-87.6582, 41.8868],
    activity: [
      {
        type: "Plan Commission",
        title: "Nearby planned development hearing",
        date: "2026-05-16",
        distance: "410 ft",
        url: sourceLinks.planCommission,
      },
      {
        type: "Permit",
        title: "New construction permit issued in corridor",
        date: "2026-04-28",
        distance: "330 ft",
        url: sourceLinks.permits,
      },
    ],
    source: "sample",
  },
  {
    id: "p2",
    title: "3200 N Clark St",
    pin: "14-20-221-010-0000",
    aliases: ["clark", "3200 n clark", "lakeview", "14-20-221"],
    ward: "44",
    community: "Lake View",
    lotArea: "12,480 sq ft",
    zoning: "B3-3",
    zoningSummary:
      "Community shopping district. Review overlays and recent ZBA activity before assuming by-right multifamily feasibility.",
    badges: ["Pedestrian street", "ZBA activity nearby"],
    coordinates: [-87.6511, 41.9405],
    activity: [
      {
        type: "ZBA",
        title: "Variation request on nearby commercial parcel",
        date: "2026-04-18",
        distance: "280 ft",
        url: sourceLinks.zba,
      },
      {
        type: "Permit",
        title: "Interior alteration permit",
        date: "2026-03-31",
        distance: "190 ft",
        url: sourceLinks.permits,
      },
    ],
    source: "sample",
  },
  {
    id: "p3",
    title: "2201 S Michigan Ave",
    pin: "17-27-305-018-0000",
    aliases: ["michigan", "2201 s michigan", "south loop", "17-27-305"],
    ward: "3",
    community: "Near South Side",
    lotArea: "34,900 sq ft",
    zoning: "DS-3",
    zoningSummary:
      "Downtown service district. Phase 2 should enrich this with parcel-to-overlay joins and nearby PD document links.",
    badges: ["PMD review needed", "Demo signal nearby"],
    coordinates: [-87.6238, 41.8524],
    activity: [
      {
        type: "Demo",
        title: "Demolition signal within search radius",
        date: "2026-05-03",
        distance: "460 ft",
        url: "https://data.cityofchicago.org/Buildings/demolition-permits/e4xk-pud8",
      },
      {
        type: "Permit",
        title: "Reported-cost permit above activity threshold",
        date: "2026-04-11",
        distance: "500 ft",
        url: sourceLinks.permits,
      },
    ],
    source: "sample",
  },
];
