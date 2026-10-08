"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { MetricKind } from "@/lib/fields";
import { formatValue, monthLabel } from "@/lib/format";

const SERIES = "#2a78d6";
const MUTED = "#898781";
const GRID = "#e1e0d9";

const axisTick = { fill: MUTED, fontSize: 11 };

function compact(kind: MetricKind, v: number): string {
  if (kind === "percent") return `${Math.round(v)}%`;
  const s = Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  return kind === "money" ? `$${s}` : s;
}

/** One metric over time. One measure per chart, never two y-axes. */
export function MetricLineChart({ data, kind, label }: { data: { month: string; value: number | null }[]; kind: MetricKind; label: string }) {
  return (
    <div className="h-56 w-full" role="img" aria-label={`${label} by month`}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="month" tickFormatter={(m: string) => monthLabel(m)} tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
          <YAxis tickFormatter={(v: number) => compact(kind, v)} tick={axisTick} tickLine={false} axisLine={false} width={52} domain={[(min: number) => Math.min(0, min), "auto"]} />
          <Tooltip
            formatter={(v) => [formatValue({ kind }, Number(v)), label]}
            labelFormatter={(m) => monthLabel(String(m), true)}
            contentStyle={{ borderRadius: 8, borderColor: GRID, fontSize: 13 }}
          />
          <Line type="linear" dataKey="value" stroke={SERIES} strokeWidth={2} dot={{ r: 4, fill: SERIES, strokeWidth: 0 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Months of runway per company, with reference lines at the warning thresholds. */
export function RunwayChart({ data, critical, serious }: { data: { company: string; runway: number }[]; critical: number; serious: number }) {
  const max = Math.max(serious, ...data.map((d) => d.runway)) * 1.15;
  return (
    <div className="w-full" style={{ height: Math.max(220, data.length * 40 + 60) }} role="img" aria-label="Months of runway by company">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 24, right: 48, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" domain={[0, max]} tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={(v: number) => `${Math.round(v)}`} />
          <YAxis type="category" dataKey="company" tick={{ ...axisTick, fill: "#52514e", fontSize: 12 }} tickLine={false} axisLine={false} width={120} />
          <Tooltip formatter={(v) => [`${Number(v).toFixed(1)} months`, "Runway"]} cursor={{ fill: "#f0efec" }} contentStyle={{ borderRadius: 8, borderColor: GRID, fontSize: 13 }} />
          {[
            [critical, "Critical"],
            [serious, "Fundraise"],
          ].map(([x, name]) => (
            <ReferenceLine key={name} x={x} stroke={MUTED} strokeDasharray="3 3" label={{ value: `${name} (${x} mo)`, position: "top", fill: MUTED, fontSize: 11 }} />
          ))}
          <Bar dataKey="runway" fill={SERIES} radius={[0, 4, 4, 0]} barSize={22} isAnimationActive={false}>
            <LabelList dataKey="runway" position="right" formatter={(v) => `${Number(v).toFixed(1)} mo`} style={{ fill: "#52514e", fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
