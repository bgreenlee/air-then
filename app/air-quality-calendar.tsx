"use client";

import { useState } from "react";

export type CalendarDatum = {
  date: string;
  color?: string;
  details?: string[];
};

type Props = {
  year: number;
  days: Map<string, CalendarDatum>;
  ariaLabel: string;
  months: string[];
};

export function fullYearDates(year: number) {
  const dates: string[] = [];
  for (let date = new Date(Date.UTC(year, 0, 1)); date.getUTCFullYear() === year; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

export function yearGradient(year: number, days: Map<string, CalendarDatum>, missingColor: string) {
  const dates = fullYearDates(year);
  return `linear-gradient(90deg, ${dates.map((date, index) => {
    const color = days.get(date)?.color ?? missingColor;
    const start = index / dates.length * 100;
    const end = (index + 1) / dates.length * 100;
    return `${color} ${start}%, ${color} ${end}%`;
  }).join(", ")})`;
}

export function AirQualityCalendar({ year, days, ariaLabel, months }: Props) {
  const [hovered, setHovered] = useState<{ datum: CalendarDatum; x: number; y: number } | null>(null);
  const dates = fullYearDates(year);
  return <>
    <div className="calendar-wrap">
      <div className="month-labels">{months.map((month) => <span key={month}>{month}</span>)}</div>
      <div className="calendar" aria-label={ariaLabel}>
        {dates.map((date) => {
          const datum = days.get(date);
          return <div key={date} role="img" tabIndex={datum ? 0 : undefined}
            aria-label={datum?.details?.join(", ") ?? `${date}: No data`}
            onMouseMove={(event) => datum && setHovered({ datum, x: event.clientX, y: event.clientY })}
            onMouseLeave={() => setHovered(null)}
            onFocus={(event) => { if (datum) { const box = event.currentTarget.getBoundingClientRect(); setHovered({ datum, x: box.left + box.width / 2, y: box.bottom }); } }}
            onBlur={() => setHovered(null)}
            className={`day ${datum ? "" : "empty"}`}
            style={datum?.color ? { backgroundColor: datum.color } : undefined}/>;
        })}
      </div>
    </div>
    {hovered && <div className="calendar-tooltip" role="tooltip" style={{ left: hovered.x + 14, top: hovered.y + 14 }}>
      <b>{new Date(`${hovered.datum.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</b>
      {(hovered.datum.details ?? []).map((detail) => <span key={detail}>{detail}</span>)}
    </div>}
  </>;
}
