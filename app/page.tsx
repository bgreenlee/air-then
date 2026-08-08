"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, LocateFixed, Search } from "lucide-react";
import {
  AirQualityCalendar,
  type CalendarDatum,
  fullYearDates,
  yearGradient,
} from "./air-quality-calendar";

type Day = {
  date: string;
  aqi: number | null;
  pollutant: string | null;
  source?: string;
  data_status?: string;
};
type Measurement = {
  date: string;
  pollutant: string;
  value: number;
  units: string;
  observation_count: number;
};
type SearchResult = {
  area_id: string;
  label?: string;
  name?: string;
  type?: "city" | "metro" | "monitor";
};

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const ramp: Record<string, string> = {
  good: "#76c47f",
  moderate: "#f1ce54",
  sensitive: "#ef9b4f",
  unhealthy: "#d45c50",
  "very-unhealthy": "#8e618e",
  hazardous: "#7a3d32",
  missing: "#e8eeea",
};
const colorStops = [
  [0, "#76c47f"],
  [50, "#b5ce67"],
  [100, "#f1ce54"],
  [150, "#ef9b4f"],
  [200, "#d45c50"],
  [300, "#8e618e"],
  [500, "#7a3d32"],
] as const;
const internationalColors = [
  "#76c47f",
  "#b5ce67",
  "#f1ce54",
  "#ef9b4f",
  "#d45c50",
  "#8e618e",
];
const internationalBands: Record<string, number[]> = {
  pm25: [5, 15, 50, 90, 140],
  pm10: [15, 45, 120, 195, 270],
  no2: [10, 25, 60, 100, 150],
  o3: [60, 100, 120, 160, 180],
  so2: [20, 40, 125, 190, 275],
};
// Keep the initial render deterministic: the Cloudflare Worker may expose an
// epoch clock during SSR, while the browser has the actual current date.
const currentYear = 2026;

function category(aqi: number | null) {
  if (aqi === null) return "Not reported";
  return aqi <= 50
    ? "Good"
    : aqi <= 100
      ? "Moderate"
      : aqi <= 150
        ? "Unhealthy for sensitive groups"
        : aqi <= 200
          ? "Unhealthy"
          : aqi <= 300
            ? "Very unhealthy"
            : "Hazardous";
}

function aqiColor(aqi: number | null) {
  if (aqi === null) return ramp.missing;
  const value = Math.min(500, Math.max(0, aqi));
  const upperIndex = colorStops.findIndex(([stop]) => value <= stop);
  if (upperIndex === 0) return colorStops[0][1];
  const [lowValue, lowColor] =
    colorStops[upperIndex === -1 ? colorStops.length - 1 : upperIndex - 1];
  const [highValue, highColor] =
    colorStops[upperIndex === -1 ? colorStops.length - 1 : upperIndex];
  const mix = (value - lowValue) / Math.max(1, highValue - lowValue);
  const low = lowColor
    .match(/[\da-f]{2}/gi)!
    .map((hex) => Number.parseInt(hex, 16));
  const high = highColor
    .match(/[\da-f]{2}/gi)!
    .map((hex) => Number.parseInt(hex, 16));
  return `rgb(${low.map((channel, index) => Math.round(channel + (high[index] - channel) * mix)).join(",")})`;
}

function internationalBand(pollutant: string, value: number) {
  const thresholds = internationalBands[pollutant.toLowerCase()];
  return thresholds
    ? thresholds.findIndex((threshold) => value <= threshold) + 1 ||
        thresholds.length
    : 0;
}

function aqiYearGradient(year: number, reportedDays: Day[]) {
  const stripDays = new Map<string, CalendarDatum>();
  for (const day of reportedDays)
    if (day.aqi !== null)
      stripDays.set(day.date, { date: day.date, color: aqiColor(day.aqi) });
  return yearGradient(year, stripDays, ramp.missing);
}

function displayArea(name: string) {
  return name.replace(/\s+CBSA$/, "");
}

export default function Home() {
  const [query, setQuery] = useState("Seattle, WA");
  const [year, setYear] = useState(currentYear);
  const [locationStatus, setLocationStatus] = useState("");
  const [dataArea, setDataArea] = useState("Loading metro area…");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [isCurrentLocation, setIsCurrentLocation] = useState(false);
  const [dataSource, setDataSource] = useState("Daily monitor aggregate");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const historicalYears = useMemo(
    () => Array.from({ length: 10 }, (_, index) => currentYear - 9 + index),
    [],
  );
  const [historicalDays, setHistoricalDays] = useState<Record<number, Day[]>>(
    {},
  );
  const [locationType, setLocationType] = useState<"aqi" | "monitor">("aqi");
  const [measurements, setMeasurements] = useState<
    Record<number, Measurement[]>
  >({});
  const days = useMemo(
    () => historicalDays[year] ?? [],
    [historicalDays, year],
  );

  function selectLocation(result: SearchResult) {
    const label = result.label ?? result.name ?? "Metro area";
    setDataArea(label.split(" → ").at(-1) ?? label);
    setAreaId(result.area_id);
    setLocationType(result.type === "monitor" ? "monitor" : "aqi");
    setQuery(label);
    setSuggestions([]);
  }

  async function resolveLocation(
    search: string,
    coordinates?: { lat: number; lon: number },
  ) {
    const params = coordinates
      ? new URLSearchParams({
          lat: String(coordinates.lat),
          lon: String(coordinates.lon),
        })
      : new URLSearchParams({ q: search });
    const response = await fetch(`/api/locations/search?${params}`);
    const payload = await response.json();
    const result = payload.results?.[0];
    if (!result)
      throw new Error("No metro-area AQI record was found for that location.");
    selectLocation(result);
  }

  useEffect(() => {
    if (!searchFocused || query.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/locations/search?q=${encodeURIComponent(query)}`)
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((payload) => setSuggestions(payload.results ?? []))
        .catch(() => setSuggestions([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, searchFocused]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/locations/search?q=Seattle")
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Location search unavailable")),
      )
      .then((payload) => {
        if (cancelled) return;
        const result: SearchResult | undefined = payload.results?.[0];
        if (!result) throw new Error("Seattle AQI data unavailable");
        const label = result.label ?? result.name ?? "Seattle, WA";
        setDataArea(label.split(" → ").at(-1) ?? label);
        setAreaId(result.area_id);
        setLocationType(result.type === "monitor" ? "monitor" : "aqi");
        setQuery(label);
      })
      .catch(() => {
        if (!cancelled) setDataArea("AQI data unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!areaId || locationType !== "aqi") return;
    let cancelled = false;
    void fetch(
      `/api/aqi/history?location_id=${encodeURIComponent(areaId)}&start_year=${historicalYears[0]}&end_year=${historicalYears.at(-1)}`,
    )
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("AQI history unavailable")),
      )
      .then((payload) => {
        if (cancelled) return;
        setHistoricalDays(payload.days_by_year ?? {});
        setDataSource(
          payload.data_source?.source === "airnow_preliminary"
            ? "AirNow daily monitor aggregate · Preliminary"
            : "EPA daily AQI aggregate",
        );
      })
      .catch(() => {
        if (!cancelled) setHistoricalDays({});
      });
    return () => {
      cancelled = true;
    };
  }, [areaId, locationType, historicalYears]);
  useEffect(() => {
    if (!areaId || locationType !== "monitor") return;
    let cancelled = false;
    void fetch(
      `/api/pollutants/history?location_id=${encodeURIComponent(areaId)}&start_year=${historicalYears[0]}&end_year=${historicalYears.at(-1)}`,
    )
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Pollutant history unavailable")),
      )
      .then((payload) => {
        if (!cancelled) {
          const byYear = payload.measurements_by_year ?? {};
          setMeasurements(byYear);
          const availableYears = Object.keys(byYear)
            .filter((key) => byYear[key].length > 0)
            .map(Number);
          if (availableYears.length) setYear(Math.max(...availableYears));
          setDataSource(
            `${payload.data_source?.source ?? "OpenAQ"} daily measurements`,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setMeasurements({});
      });
    return () => {
      cancelled = true;
    };
  }, [areaId, locationType, historicalYears]);
  const stats = useMemo(() => {
    const values = days
      .flatMap((d) => (d.aqi === null ? [] : [d.aqi]))
      .sort((a, b) => a - b);
    return {
      median: values.length ? values[Math.floor(values.length / 2)] : "—",
      max: values.length ? Math.max(...values) : "—",
      gt50: values.filter((x) => x > 50).length,
      gt100: values.filter((x) => x > 100).length,
    };
  }, [days]);
  const annualTrends = useMemo(
    () =>
      historicalYears.map((trendYear) => {
        const values = (historicalDays[trendYear] ?? [])
          .flatMap((day) => (day.aqi === null ? [] : [day.aqi]))
          .sort((a, b) => a - b);
        return {
          year: trendYear,
          median: values.length ? values[Math.floor(values.length / 2)] : null,
          p90: values.length
            ? values[
                Math.min(values.length - 1, Math.ceil(values.length * 0.9) - 1)
              ]
            : null,
          daysAbove100: values.filter((value) => value > 100).length,
        };
      }),
    [historicalDays, historicalYears],
  );
  const trendScale = Math.max(
    100,
    ...annualTrends.flatMap((trend) => (trend.p90 === null ? [] : [trend.p90])),
  );
  const trendMaxDays = Math.max(
    1,
    ...annualTrends.map((trend) => trend.daysAbove100),
  );
  const calendarDays = new Map<string, CalendarDatum>(
    days.flatMap((day) =>
      day.aqi === null
        ? []
        : [
            [
              day.date,
              {
                date: day.date,
                color: aqiColor(day.aqi),
                details: [
                  `AQI ${day.aqi} · ${category(day.aqi)} · ${day.pollutant}`,
                ],
              },
            ],
          ],
    ),
  );
  const pollutantStats = useMemo(() => {
    const yearMeasurements = measurements[year] ?? [];
    return Object.entries(
      Object.groupBy(yearMeasurements, (row) => row.pollutant),
    ).flatMap(([pollutant, rows]) => {
      if (!rows?.length) return [];
      const values = rows.map((row) => row.value).sort((a, b) => a - b);
      return [
        {
          pollutant,
          units: rows[0].units,
          median: values[Math.floor(values.length / 2)],
          max: Math.max(...values),
          days: new Set(rows.map((row) => row.date)).size,
        },
      ];
    });
  }, [measurements, year]);

  return (
    <main>
      <nav>
        <div className="brand-block">
          <a className="brand" href="#top">
            <Image
              className="brand-mark"
              width={28}
              height={28}
              src="/airthen-mark.svg"
              alt=""
              priority
            />
            AirThen
          </a>
          <span className="brand-subtitle">Historical air quality</span>
        </div>
        <div className="nav-links">
          <a
            className="github-link"
            href="https://github.com/bgreenlee/air-then"
            target="_blank"
            rel="noreferrer"
            aria-label="AirThen on GitHub"
          >
            {/* GitHub's brand mark is not part of the Lucide icon set. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://github.githubassets.com/favicons/favicon.svg"
              alt=""
            />
          </a>
        </div>
      </nav>
      <section className="hero" id="top">
        <p className="intro">
          Daily air quality records for cities and metro areas across the U.S.,
          Canada, and France.
        </p>
        <div className="search-area">
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              setLocationStatus("Resolving location…");
              void resolveLocation(query)
                .then(() => {
                  setIsCurrentLocation(false);
                  setLocationStatus("");
                })
                .catch((error) => setLocationStatus(error.message));
            }}
          >
            <Search
              className="search-icon"
              size={21}
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <input
              id="location-search"
              name="location"
              aria-label="Search city or ZIP code"
              value={query}
              onFocus={(e) => {
                e.currentTarget.select();
                setSearchFocused(true);
              }}
              onBlur={() =>
                window.setTimeout(() => setSearchFocused(false), 150)
              }
              onChange={(e) => {
                const value = e.target.value;
                setQuery(value);
                if (value.trim().length < 2) setSuggestions([]);
              }}
              placeholder="City or ZIP code"
            />
            <button
              className="locate"
              type="button"
              aria-label="Use my current location"
              title="Use my current location"
              onClick={() => {
                if (!navigator.geolocation) {
                  setLocationStatus(
                    "Location isn’t supported by this browser.",
                  );
                  return;
                }
                setLocationStatus("Finding your location…");
                navigator.geolocation.getCurrentPosition(
                  ({ coords }) => {
                    void resolveLocation("", {
                      lat: coords.latitude,
                      lon: coords.longitude,
                    })
                      .then(() => {
                        setIsCurrentLocation(true);
                        setLocationStatus(
                          "Location found — showing the nearest EPA metro area.",
                        );
                      })
                      .catch(() =>
                        setLocationStatus(
                          "We couldn’t resolve local AQI coverage. Search by city or ZIP instead.",
                        ),
                      );
                  },
                  () =>
                    setLocationStatus(
                      "We couldn’t access your location. Search by city or ZIP instead.",
                    ),
                  { enableHighAccuracy: false, timeout: 10000 },
                );
              }}
            >
              <LocateFixed
                className="locate-icon"
                size={18}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </button>
            <button>Explore AQI</button>
          </form>
          {searchFocused && suggestions.length > 0 && (
            <div className="autocomplete" role="listbox">
              {suggestions.map((result) => (
                <button
                  key={`${result.area_id}-${result.label ?? result.name}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    selectLocation(result);
                    setSearchFocused(false);
                    setIsCurrentLocation(false);
                  }}
                >
                  <span>{result.label ?? result.name}</span>
                  <small>
                    {result.type === "city"
                      ? "City"
                      : result.type === "monitor"
                        ? "International monitor"
                        : "Metro area"}
                  </small>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="hint">
          {locationStatus || (
            <>
              Try{" "}
              <button
                onClick={() => {
                  setQuery("Seattle–Tacoma–Bellevue CBSA");
                  setDataArea("Seattle–Tacoma–Bellevue CBSA");
                }}
              >
                98101
              </button>
              ,{" "}
              <button
                onClick={() => {
                  setQuery("Winthrop, WA");
                }}
              >
                Winthrop, WA
              </button>
              , or any U.S. city
            </>
          )}
        </div>
      </section>
      <section className="explorer" id="explore">
        <div className="result-head">
          <div>
            <p className="eyebrow">Search result</p>
            <h2>{displayArea(dataArea)}</h2>
            <p className="subtle">
              {locationType === "monitor"
                ? "International monitor"
                : "Metro area"}{" "}
              · {dataSource}
            </p>
            <p className="resolution-note">
              <b>Why this source?</b>{" "}
              {locationType === "monitor"
                ? "Daily pollutant concentrations from a monitoring station."
                : isCurrentLocation
                  ? "Your current location resolves to the nearest EPA metro area."
                  : "This result has strong daily monitoring coverage."}
            </p>
          </div>
          <div className="year-controls">
            <button
              onClick={() => setYear(year - 1)}
              aria-label="Previous year"
            >
              <ChevronLeft size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <strong>{year}</strong>
            <button
              onClick={() => setYear(year + 1)}
              disabled={year >= currentYear}
              aria-label="Next year"
            >
              <ChevronRight size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </div>
        {locationType === "monitor" ? (
          <InternationalView
            measurements={Object.values(measurements).flat()}
            displayYear={year}
            onYearChange={setYear}
            stats={pollutantStats}
          />
        ) : (
          <>
            <div className="metrics">
              <Metric value={stats.median} label="Median AQI" tone="good" />
              <Metric value={stats.max} label="Maximum AQI" tone="sensitive" />
              <Metric
                value={stats.gt50}
                label="Days above 50"
                tone="moderate"
              />
              <Metric
                value={stats.gt100}
                label="Days above 100"
                tone="unhealthy"
              />
            </div>
            <div className="chart-card">
              <div className="chart-heading">
                <div>
                  <p className="eyebrow">Daily AQI calendar</p>
                  <p>
                    Each square is one day. Higher values mean greater health
                    concern.
                  </p>
                </div>
              </div>
              <AirQualityCalendar
                year={year}
                days={calendarDays}
                ariaLabel={`Daily AQI calendar for ${year}`}
                months={months}
              />
              <div className="legend">
                <span>Lower impact</span>
                {[
                  "good",
                  "moderate",
                  "sensitive",
                  "unhealthy",
                  "very-unhealthy",
                  "hazardous",
                ].map((k) => (
                  <i key={k} className={k} />
                ))}
                <span>Higher impact</span>
                <i className="missing" />
                <span>No data</span>
              </div>
            </div>
            <div className="history-card">
              <div>
                <p className="eyebrow">Historical view</p>
                <p>
                  Each strip condenses a full year into daily AQI. Select a year
                  to inspect it above.
                </p>
              </div>
              <div className="history-timeline">
                <div className="history-months" aria-hidden="true">
                  {months.map((month) => (
                    <span key={month}>{month}</span>
                  ))}
                </div>
                <div className="year-strips">
                  {historicalYears.map((y) => {
                    const row = historicalDays[y];
                    return (
                      <button
                        className={
                          y === year ? "year-strip selected" : "year-strip"
                        }
                        onClick={() => setYear(y)}
                        key={y}
                        aria-label={`Show AQI calendar for ${y}`}
                      >
                        <b>{y}</b>
                        <span
                          className="year-ramp"
                          style={
                            row
                              ? { backgroundImage: aqiYearGradient(y, row) }
                              : undefined
                          }
                        />
                        <em>{y === year ? "Viewing" : ""}</em>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="trend-card">
              <div className="trend-heading">
                <div>
                  <p className="eyebrow">Annual trend</p>
                  <p>
                    Median and P90 AQI summarize each year; the bars count days
                    above 100.
                  </p>
                </div>
                <div className="trend-legend">
                  <span>
                    <i className="median-dot" />
                    Median
                  </span>
                  <span>
                    <i className="p90-dot" />
                    P90
                  </span>
                </div>
              </div>
              <div className="trend-plot" aria-label="Annual AQI trend">
                {annualTrends.map((trend) => {
                  const medianTop =
                    trend.median === null
                      ? null
                      : 100 - (trend.median / trendScale) * 100;
                  const p90Top =
                    trend.p90 === null
                      ? null
                      : 100 - (trend.p90 / trendScale) * 100;
                  return (
                    <div className="trend-column" key={trend.year}>
                      <div className="trend-range-area">
                        {medianTop !== null && p90Top !== null && (
                          <>
                            <span
                              className="trend-range"
                              style={{
                                top: `${p90Top}%`,
                                height: `${Math.max(3, medianTop - p90Top)}%`,
                              }}
                            />
                            <i
                              className="trend-p90"
                              style={{ top: `${p90Top}%` }}
                            />
                            <i
                              className="trend-median"
                              style={{ top: `${medianTop}%` }}
                            />
                          </>
                        )}
                      </div>
                      <div className="trend-bar-area">
                        <span
                          className="trend-bar"
                          style={{
                            height: `${(trend.daysAbove100 / trendMaxDays) * 100}%`,
                          }}
                        />
                      </div>
                      <b>{trend.year}</b>
                    </div>
                  );
                })}
              </div>
              <div className="trend-axis">
                <span>P90 / median AQI</span>
                <span>Days above 100</span>
              </div>
            </div>
          </>
        )}
      </section>
      <footer>
        <span>
          AirThen is built from{" "}
          <a
            href="https://www.epa.gov/outdoor-air-quality-data"
            target="_blank"
            rel="noreferrer"
          >
            EPA AirData
          </a>{" "}
          bulk files,{" "}
          <a href="https://openaq.org/" target="_blank" rel="noreferrer">
            OpenAQ
          </a>{" "}
          measurements, and Census geographic references.
        </span>
      </footer>
    </main>
  );
}

function InternationalView({
  measurements,
  displayYear,
  onYearChange,
  stats,
}: {
  measurements: Measurement[];
  displayYear: number;
  onYearChange: (year: number) => void;
  stats: {
    pollutant: string;
    units: string;
    median: number;
    max: number;
    days: number;
  }[];
}) {
  const byDate = new Map<string, Measurement[]>();
  for (const row of measurements)
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  const calendarDays = new Map<string, CalendarDatum>();
  for (const date of fullYearDates(displayYear)) {
    const rows = byDate.get(date) ?? [];
    if (!rows.length) continue;
    const band = Math.max(
      ...rows.map((row) => internationalBand(row.pollutant, row.value)),
    );
    calendarDays.set(date, {
      date,
      color: internationalColors[Math.max(0, band - 1)],
      details: rows.map(
        (row) =>
          `${row.pollutant}: ${row.value.toFixed(1)} ${row.units} · ${row.observation_count} observations`,
      ),
    });
  }
  const years = [
    ...new Set(measurements.map((row) => Number(row.date.slice(0, 4)))),
  ].sort((a, b) => a - b);
  const yearStrip = (stripYear: number) => {
    const stripDays = new Map<string, CalendarDatum>();
    for (const date of fullYearDates(stripYear)) {
      const rows = byDate.get(date) ?? [];
      if (!rows.length) continue;
      const band = Math.max(
        ...rows.map((row) => internationalBand(row.pollutant, row.value)),
      );
      stripDays.set(date, {
        date,
        color: internationalColors[Math.max(0, band - 1)],
      });
    }
    return yearGradient(stripYear, stripDays, ramp.missing);
  };
  const internationalTrends = years.map((trendYear) => {
    const values = [
      ...new Set(
        measurements
          .filter((row) => row.date.startsWith(`${trendYear}-`))
          .map((row) => row.date),
      ),
    ]
      .map((date) =>
        Math.max(
          ...(byDate.get(date) ?? []).map((row) =>
            internationalBand(row.pollutant, row.value),
          ),
          0,
        ),
      )
      .sort((a, b) => a - b);
    return {
      year: trendYear,
      median: values.length ? values[Math.floor(values.length / 2)] : null,
      p90: values.length
        ? values[
            Math.min(values.length - 1, Math.ceil(values.length * 0.9) - 1)
          ]
        : null,
      days: values.filter((value) => value > 0.5).length,
    };
  });
  const internationalScale = 5;
  const internationalMaxDays = Math.max(
    1,
    ...internationalTrends.map((trend) => trend.days),
  );
  return (
    <>
      <div className="metrics">
        {stats.map((stat) => (
          <Metric
            key={stat.pollutant}
            value={`${stat.median.toFixed(1)} ${stat.units}`}
            label={`${stat.pollutant} median`}
            tone="good"
          />
        ))}
        <Metric
          value={
            measurements.length
              ? new Set(measurements.map((row) => row.date)).size
              : 0
          }
          label="Days with measurements"
          tone="moderate"
        />
      </div>
      <div className="chart-card">
        <div className="chart-heading">
          <div>
            <p className="eyebrow">Combined daily pollutant calendar</p>
            <p>
              Each square uses the worse EEA-style concentration band among the
              reported pollutants. Hover a day for details.
            </p>
          </div>
        </div>
        <AirQualityCalendar
          year={displayYear}
          days={calendarDays}
          ariaLabel={`Combined daily pollutant calendar for ${displayYear}`}
          months={months}
        />
        <div className="legend">
          <span>Good</span>
          {internationalColors.map((color, index) => (
            <i
              key={color}
              style={{ backgroundColor: color }}
              aria-label={`Band ${index + 1}`}
            />
          ))}
          <span>Extremely poor</span>
          <i className="missing" />
          <span>No data</span>
        </div>
      </div>
      <div className="history-card">
        <div>
          <p className="eyebrow">Historical view</p>
          <p>
            Each strip condenses a year into daily combined pollutant levels.
          </p>
        </div>
        <div className="history-timeline">
          <div className="history-months" aria-hidden="true">
            {months.map((month) => (
              <span key={month}>{month}</span>
            ))}
          </div>
          <div className="year-strips">
            {years.map((stripYear) => (
              <button
                className={
                  stripYear === displayYear
                    ? "year-strip selected"
                    : "year-strip"
                }
                onClick={() => onYearChange(stripYear)}
                key={stripYear}
                aria-label={`Show combined pollutant calendar for ${stripYear}`}
              >
                <b>{stripYear}</b>
                <span
                  className="year-ramp"
                  style={{ backgroundImage: yearStrip(stripYear) }}
                />
                <em>{stripYear === displayYear ? "Viewing" : ""}</em>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="trend-card">
        <div className="trend-heading">
          <div>
            <p className="eyebrow">Annual trend</p>
            <p>
              Median and P90 summarize the EEA-style combined bands; bars count
              days above the midpoint.
            </p>
          </div>
          <div className="trend-legend">
            <span>
              <i className="median-dot" />
              Median band
            </span>
            <span>
              <i className="p90-dot" />
              P90 band
            </span>
          </div>
        </div>
        <div
          className="trend-plot"
          aria-label="Annual combined pollutant trend"
        >
          {internationalTrends.map((trend) => {
            const medianTop =
              trend.median === null
                ? null
                : 100 - (trend.median / internationalScale) * 100;
            const p90Top =
              trend.p90 === null
                ? null
                : 100 - (trend.p90 / internationalScale) * 100;
            return (
              <div className="trend-column" key={trend.year}>
                <div className="trend-range-area">
                  {medianTop !== null && p90Top !== null && (
                    <>
                      <span
                        className="trend-range"
                        style={{
                          top: `${p90Top}%`,
                          height: `${Math.max(3, medianTop - p90Top)}%`,
                        }}
                      />
                      <i className="trend-p90" style={{ top: `${p90Top}%` }} />
                      <i
                        className="trend-median"
                        style={{ top: `${medianTop}%` }}
                      />
                    </>
                  )}
                </div>
                <div className="trend-bar-area">
                  <span
                    className="trend-bar"
                    style={{
                      height: `${(trend.days / internationalMaxDays) * 100}%`,
                    }}
                  />
                </div>
                <b>{trend.year}</b>
              </div>
            );
          })}
        </div>
        <div className="trend-axis">
          <span>EEA-style P90 / median band</span>
          <span>Days above midpoint</span>
        </div>
      </div>
      <div className="history-card">
        <p className="eyebrow">About this data</p>
        <p>
          AirThen currently shows pollutant concentrations for international
          stations. AQI scales differ by country, so we don’t convert these
          measurements into the U.S. AQI scale.
        </p>
      </div>
    </>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone: string;
}) {
  return (
    <div className="metric">
      <i className={tone} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
