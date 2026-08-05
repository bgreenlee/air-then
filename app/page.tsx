"use client";

import { useEffect, useMemo, useState } from "react";

type Day = { date: string; aqi: number | null; pollutant: string | null; source?: string; data_status?: string };

const palette = ["", "good", "moderate", "sensitive", "unhealthy", "very-unhealthy", "hazardous"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ramp: Record<string, string> = { good: "#76c47f", moderate: "#f1ce54", sensitive: "#ef9b4f", unhealthy: "#d45c50", "very-unhealthy": "#8e618e", hazardous: "#7a3d32", missing: "#e8eeea" };
const colorStops = [[0, "#76c47f"], [50, "#b5ce67"], [100, "#f1ce54"], [150, "#ef9b4f"], [200, "#d45c50"], [300, "#8e618e"], [500, "#7a3d32"]] as const;
const cbsas = [
  [47.6062, -122.3321, "Seattle–Tacoma–Bellevue CBSA"], [40.7128, -74.006, "New York–Newark–Jersey City CBSA"],
  [34.0522, -118.2437, "Los Angeles–Long Beach–Anaheim CBSA"], [41.8781, -87.6298, "Chicago–Naperville–Elgin CBSA"],
  [29.7604, -95.3698, "Houston–The Woodlands–Sugar Land CBSA"], [33.749, -84.388, "Atlanta–Sandy Springs–Alpharetta CBSA"],
  [37.7749, -122.4194, "San Francisco–Oakland–Berkeley CBSA"], [42.3601, -71.0589, "Boston–Cambridge–Newton CBSA"],
] as const;
const now = new Date();
const currentYear = now.getFullYear();
const today = [currentYear, String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");

function bucket(aqi: number | null) {
  if (aqi === null) return "missing";
  return palette[aqi <= 50 ? 1 : aqi <= 100 ? 2 : aqi <= 150 ? 3 : aqi <= 200 ? 4 : aqi <= 300 ? 5 : 6];
}

function category(aqi: number | null) {
  if (aqi === null) return "Not reported";
  return aqi <= 50 ? "Good" : aqi <= 100 ? "Moderate" : aqi <= 150 ? "Unhealthy for sensitive groups" : aqi <= 200 ? "Unhealthy" : aqi <= 300 ? "Very unhealthy" : "Hazardous";
}

function aqiColor(aqi: number | null) {
  if (aqi === null) return ramp.missing;
  const value = Math.min(500, Math.max(0, aqi));
  const upperIndex = colorStops.findIndex(([stop]) => value <= stop);
  if (upperIndex === 0) return colorStops[0][1];
  const [lowValue, lowColor] = colorStops[upperIndex === -1 ? colorStops.length - 1 : upperIndex - 1];
  const [highValue, highColor] = colorStops[upperIndex === -1 ? colorStops.length - 1 : upperIndex];
  const mix = (value - lowValue) / Math.max(1, highValue - lowValue);
  const low = lowColor.match(/[\da-f]{2}/gi)!.map((hex) => Number.parseInt(hex, 16));
  const high = highColor.match(/[\da-f]{2}/gi)!.map((hex) => Number.parseInt(hex, 16));
  return `rgb(${low.map((channel, index) => Math.round(channel + (high[index] - channel) * mix)).join(",")})`;
}

function demoDays(year: number): Day[] {
  const dates: Day[] = [];
  for (let d = new Date(`${year}-01-01T12:00:00`); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const n = Math.floor((d.getTime() / 86400000 + year * 11) % 29);
    const summer = d.getMonth() >= 5 && d.getMonth() <= 8;
    const futureDate = year === currentYear && d.toISOString().slice(0, 10) > today;
    const aqi = futureDate || n === 0 ? null : Math.max(14, Math.round(31 + Math.sin(d.getDate() / 3) * 13 + (summer ? 21 : 0) + (n === 6 ? 62 : 0)));
    dates.push({ date: d.toISOString().slice(0, 10), aqi, pollutant: aqi && aqi > 55 ? "Ozone" : "PM2.5" });
  }
  return dates;
}

function dailyGradient(days: Day[]) {
  const width = 100 / days.length;
  return `linear-gradient(90deg, ${days.map((day, index) => {
    const color = aqiColor(day.aqi);
    const start = index * width;
    const end = (index + 1) * width;
    return `${color} ${Math.max(0, start - width * .18)}%, ${color} ${end + width * .18}%`;
  }).join(", ")})`;
}

function fullYearDays(year: number, reportedDays: Day[]) {
  const byDate = new Map(reportedDays.map((day) => [day.date, day]));
  const dates: Day[] = [];
  for (let date = new Date(year, 0, 1); date.getFullYear() === year; date.setDate(date.getDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    dates.push(byDate.get(key) ?? { date: key, aqi: null, pollutant: null });
  }
  return dates;
}

function nearestCbsa(latitude: number, longitude: number) {
  return cbsas.reduce((nearest, cbsa) => {
    const distance = (cbsa[0] - latitude) ** 2 + (cbsa[1] - longitude) ** 2;
    return distance < nearest.distance ? { name: cbsa[2], distance } : nearest;
  }, { name: cbsas[0][2], distance: Infinity }).name;
}

function displayArea(name: string) {
  return name.replace(/\s+CBSA$/, "");
}

function resolveCbsa(query: string) {
  const normalized = query.toLowerCase();
  if (normalized.includes("981")) return cbsas[0][2];
  const match = cbsas.find(([, , name]) => name.toLowerCase().split("–")[0].includes(normalized.split(",")[0].trim()));
  return match?.[2] ?? cbsas[0][2];
}

export default function Home() {
  const [query, setQuery] = useState("Seattle, WA");
  const [year, setYear] = useState(currentYear);
  const [locationStatus, setLocationStatus] = useState("");
  const [dataArea, setDataArea] = useState("Loading metro area…");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [isCurrentLocation, setIsCurrentLocation] = useState(false);
  const [tooltip, setTooltip] = useState<{ day: Day; x: number; y: number } | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [dataSource, setDataSource] = useState("Daily monitor aggregate");
  const historicalYears = useMemo(() => Array.from({ length: 10 }, (_, index) => currentYear - 9 + index), []);
  const [historicalDays, setHistoricalDays] = useState<Record<number, Day[]>>({});

  async function resolveLocation(search: string, coordinates?: { lat: number; lon: number }) {
    const params = coordinates ? new URLSearchParams({ lat: String(coordinates.lat), lon: String(coordinates.lon) }) : new URLSearchParams({ q: search });
    const response = await fetch(`/api/locations/search?${params}`);
    const payload = await response.json();
    const result = payload.results?.[0];
    if (!result) throw new Error("No metro-area AQI record was found for that location.");
    setDataArea(result.label); setAreaId(result.area_id); setQuery(result.label);
  }

  useEffect(() => {
    const loadFallback = () => void resolveLocation("Seattle").catch(() => { setDataArea("AQI data unavailable"); setDays([]); });
    if (!navigator.geolocation) { loadFallback(); return; }
    setLocationStatus("Finding your local metro area…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        void resolveLocation("", { lat: coords.latitude, lon: coords.longitude })
          .then(() => { setIsCurrentLocation(true); setLocationStatus(""); })
          .catch(() => { setLocationStatus(""); loadFallback(); });
      },
      () => { setLocationStatus(""); loadFallback(); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }, []);
  useEffect(() => {
    if (!areaId) return;
    void fetch(`/api/aqi/history?location_id=${encodeURIComponent(areaId)}&year=${year}`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error("AQI history unavailable")))
      .then(payload => { setDays(payload.days); setDataSource(payload.data_source?.source === "airnow_preliminary" ? "AirNow daily monitor aggregate · Preliminary" : "EPA daily AQI aggregate"); })
      .catch(() => setDays([]));
  }, [areaId, year]);
  useEffect(() => {
    if (!areaId) return;
    let cancelled = false;
    void Promise.all(historicalYears.map(async (historyYear) => {
      const response = await fetch(`/api/aqi/history?location_id=${encodeURIComponent(areaId)}&year=${historyYear}`);
      if (!response.ok) throw new Error("AQI history unavailable");
      const payload = await response.json();
      return [historyYear, payload.days as Day[]] as const;
    })).then((entries) => {
      if (!cancelled) setHistoricalDays(Object.fromEntries(entries));
    }).catch(() => {
      if (!cancelled) setHistoricalDays({});
    });
    return () => { cancelled = true; };
  }, [areaId, historicalYears]);
  const stats = useMemo(() => {
    const values = days.flatMap((d) => d.aqi === null ? [] : [d.aqi]).sort((a,b) => a-b);
    return { median: values.length ? values[Math.floor(values.length / 2)] : "—", max: values.length ? Math.max(...values) : "—", gt50: values.filter(x => x > 50).length, gt100: values.filter(x => x > 100).length };
  }, [days]);
  const dayByDate = new Map(days.map(day => [day.date, day]));
  const cells = Array.from({ length: 371 }, (_, index) => {
    const date = new Date(year, 0, index + 1);
    return date.getFullYear() === year ? dayByDate.get(date.toISOString().slice(0, 10)) ?? { date: date.toISOString().slice(0, 10), aqi: null, pollutant: null } : null;
  });

  return <main>
    <nav><a className="brand" href="#top"><span>◎</span> Clear Skies</a><div className="nav-links"><a href="https://www.epa.gov/outdoor-air-quality-data" target="_blank" rel="noreferrer">EPA AirData ↗</a></div></nav>
    <section className="hero" id="top">
      <p className="eyebrow">Historical U.S. Air Quality</p>
      <p className="intro">Search a city, ZIP code, or your current location to explore daily AQI records.</p>
      <form className="search" onSubmit={(e) => { e.preventDefault(); setLocationStatus("Resolving location…"); void resolveLocation(query).then(() => { setIsCurrentLocation(false); setLocationStatus(""); }).catch(error => setLocationStatus(error.message)); }}>
        <span>⌕</span><input aria-label="Search city or ZIP code" value={query} onChange={e => setQuery(e.target.value)} placeholder="City or ZIP code"/><button className="locate" type="button" aria-label="Use my current location" title="Use my current location" onClick={() => {
          if (!navigator.geolocation) { setLocationStatus("Location isn’t supported by this browser."); return; }
          setLocationStatus("Finding your location…");
          navigator.geolocation.getCurrentPosition(({ coords }) => { void resolveLocation("", { lat: coords.latitude, lon: coords.longitude }).then(() => { setIsCurrentLocation(true); setLocationStatus("Location found — showing the nearest EPA metro area."); }).catch(() => setLocationStatus("We couldn’t resolve local AQI coverage. Search by city or ZIP instead.")); }, () => setLocationStatus("We couldn’t access your location. Search by city or ZIP instead."), { enableHighAccuracy: false, timeout: 10000 });
        }}>◎</button><button>Explore AQI</button>
      </form>
      <p className="hint">{locationStatus || <>Try <button onClick={() => { setQuery("Seattle–Tacoma–Bellevue CBSA"); setDataArea("Seattle–Tacoma–Bellevue CBSA"); }}>98101</button>, <button onClick={() => { setQuery("Winthrop, WA"); }}>Winthrop, WA</button>, or any U.S. city</>}</p>
    </section>
    <section className="explorer" id="explore">
      <div className="result-head"><div><p className="eyebrow">Search result</p><h2>{displayArea(dataArea)}</h2><p className="subtle">Metro area · {dataSource}</p><p className="resolution-note"><b>Why this source?</b> {isCurrentLocation ? "Your current location resolves to the nearest EPA metro area." : "This result has strong daily monitoring coverage."}</p></div><div className="year-controls"><button onClick={() => setYear(year - 1)} aria-label="Previous year">←</button><strong>{year}</strong><button onClick={() => setYear(year + 1)} disabled={year >= currentYear} aria-label="Next year">→</button></div></div>
      <div className="metrics"><Metric value={stats.median} label="Median AQI" tone="good"/><Metric value={stats.max} label="Maximum AQI" tone="sensitive"/><Metric value={stats.gt50} label="Days above 50" tone="moderate"/><Metric value={stats.gt100} label="Days above 100" tone="unhealthy"/></div>
      <div className="chart-card"><div className="chart-heading"><div><h3>Daily AQI calendar</h3><p>Each square is one day. Higher values mean greater health concern.</p></div></div><div className="calendar-wrap"><div className="month-labels">{months.map(m => <span key={m}>{m}</span>)}</div><div className="calendar" aria-label={`Daily AQI calendar for ${year}`}>{cells.map((d, i) => <div key={i} role={d ? "img" : undefined} tabIndex={d ? 0 : undefined} aria-label={d ? `${d.date}: ${d.aqi === null ? "No AQI reported" : `AQI ${d.aqi}, ${category(d.aqi)}, ${d.pollutant}`}` : undefined} onMouseEnter={(event) => d && setTooltip({ day: d, x: event.clientX, y: event.clientY })} onMouseMove={(event) => d && setTooltip({ day: d, x: event.clientX, y: event.clientY })} onMouseLeave={() => setTooltip(null)} onFocus={(event) => { if (d) { const box = event.currentTarget.getBoundingClientRect(); setTooltip({ day: d, x: box.left + box.width / 2, y: box.bottom }); } }} onBlur={() => setTooltip(null)} className={`day ${d ? bucket(d.aqi) : "empty"}`} style={d && d.aqi !== null ? { backgroundColor: aqiColor(d.aqi) } : undefined}/>)}</div></div><div className="legend"><span>Lower impact</span>{["good","moderate","sensitive","unhealthy","very-unhealthy","hazardous"].map(k => <i key={k} className={k}/>) }<span>Higher impact</span><i className="missing"/><span>No data</span></div></div>
      <div className="history-card"><div><p className="eyebrow">Historical view</p><p>Each strip condenses a full year into daily AQI. Select a year to inspect it above.</p></div><div className="history-timeline"><div className="history-months" aria-hidden="true">{months.map(month => <span key={month}>{month}</span>)}</div><div className="year-strips">{historicalYears.map(y => { const row = historicalDays[y]; return <button className={y === year ? "year-strip selected" : "year-strip"} onClick={() => setYear(y)} key={y} aria-label={`Show AQI calendar for ${y}`}><b>{y}</b><span className="year-ramp" style={row ? { backgroundImage: dailyGradient(fullYearDays(y, row)) } : undefined}/><em>{y === year ? "Viewing" : ""}</em></button>; })}</div></div></div>
    </section>
    <footer><span>Clear Skies is built from EPA AirData bulk files and Census geographic references.</span><span className="footer-links"><a className="github-link" href="https://github.com/bgreenlee/clear-skies" target="_blank" rel="noreferrer" aria-label="Clear Skies on GitHub"><img src="https://github.githubassets.com/favicons/favicon.svg" alt=""/></a><a href="https://www.epa.gov/outdoor-air-quality-data" target="_blank" rel="noreferrer">EPA AirData ↗</a></span></footer>
    {tooltip && <div className="calendar-tooltip" role="tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}><b>{new Date(`${tooltip.day.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</b><span>{tooltip.day.aqi === null ? "No AQI reported" : `AQI ${tooltip.day.aqi} · ${category(tooltip.day.aqi)} · ${tooltip.day.pollutant}`}</span></div>}
  </main>;
}

function Metric({ value, label, tone }: { value: string | number; label: string; tone: string }) { return <div className="metric"><i className={tone}/><strong>{value}</strong><span>{label}</span></div>; }
