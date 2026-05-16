import { useEffect, useMemo, useState } from "react";
import { geoPath, geoGraticule } from "d3-geo";
import { geoAitoff } from "d3-geo-projection";
import type { Analytics as AnalyticsData } from "../../shared/ipc";
import { BarChart, type BarDatum } from "../components/BarChart";
import { buildFootprintFeature, raToLon } from "../lib/skyGeom";

export function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    window.zenith.getAnalytics().then(setData);
  }, []);

  if (!data) return <div className="dashboard"><div className="muted">Loading analytics…</div></div>;

  return (
    <div className="dashboard">
      <KpiRow data={data} />
      <CoverageCard data={data} />
      <div className="grid-2">
        <Card title="Top targets">
          <BarChart
            data={topTargetsToBars(data)}
            valueFormat={(v) =>
              v >= 3600
                ? `${(v / 3600).toFixed(1)} h`
                : v >= 60
                ? `${(v / 60).toFixed(0)} min`
                : `${v} img`
            }
          />
        </Card>
        <Card title="Targets by type">
          <BarChart
            data={data.byTargetType.map((d) => ({ label: d.type, value: d.count }))}
          />
        </Card>
      </div>
      <div className="grid-2">
        <Card title="FOV distribution">
          <BarChart
            data={data.fovHistogram.map((d) => ({ label: d.bin, value: d.count }))}
          />
        </Card>
        <Card title="Pixel scale distribution">
          <BarChart
            data={data.pixelScaleHistogram.map((d) => ({
              label: d.bin,
              value: d.count,
            }))}
          />
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Filters in use">
          {data.byFilter.length > 0 ? (
            <BarChart
              data={data.byFilter.map((d) => ({ label: d.filter, value: d.count }))}
            />
          ) : (
            <div className="muted">
              Add filter info on the image detail panel to populate this.
            </div>
          )}
        </Card>
        <Card title="Images over time">
          <BarChart
            data={data.importsByMonth.map((d) => ({ label: d.month, value: d.count }))}
          />
        </Card>
      </div>
    </div>
  );
}

function KpiRow({ data }: { data: AnalyticsData }) {
  const t = data.totals;
  const integrationHours = t.totalIntegrationS / 3600;
  return (
    <div className="kpi-row">
      <Kpi label="Images" value={t.images.toString()} sub={`${t.solvedImages} solved`} />
      <Kpi label="Unique targets" value={t.targets.toString()} />
      <Kpi
        label="Sky covered"
        value={`${t.skyCoveragePct.toFixed(2)}%`}
        sub={`${t.skyCoverageDeg2.toFixed(0)} deg²`}
      />
      <Kpi
        label="Integration"
        value={integrationHours > 0 ? `${integrationHours.toFixed(1)} h` : "—"}
        sub={integrationHours > 0 ? "(user-entered)" : "add to image detail"}
      />
      <Kpi
        label="Span"
        value={
          t.dateRange.first && t.dateRange.last
            ? `${t.dateRange.first.slice(0, 10)} → ${t.dateRange.last.slice(0, 10)}`
            : "—"
        }
      />
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub muted">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dash-card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function topTargetsToBars(data: AnalyticsData): BarDatum[] {
  return data.byTargetIntegration.map((d) => ({
    label: d.name,
    value: d.integrationS > 0 ? d.integrationS : d.imageCount,
    sublabel: d.integrationS === 0 ? `× ${d.imageCount}` : undefined,
  }));
}

function CoverageCard({ data }: { data: AnalyticsData }) {
  const w = 720;
  const h = 360;
  const projection = useMemo(
    () =>
      geoAitoff()
        .scale(Math.min((w - 40) / (2 * Math.SQRT2), (h - 40) / Math.SQRT2))
        .translate([w / 2, h / 2])
        .precision(0.5),
    [],
  );
  const pathGen = useMemo(() => geoPath(projection), [projection]);
  const graticule = useMemo(() => geoGraticule().step([30, 15])(), []);

  const features = useMemo(
    () =>
      data.coverageImages
        .map((c, i) =>
          c.footprintGeoJson
            ? buildFootprintFeature(i, "", null, c.footprintGeoJson)
            : null,
        )
        .filter((f): f is NonNullable<typeof f> => f !== null),
    [data.coverageImages],
  );

  const points = useMemo(
    () =>
      data.coverageImages.filter((c) => !c.footprintGeoJson),
    [data.coverageImages],
  );

  return (
    <div className="dash-card wide">
      <h3>Sky coverage</h3>
      <svg width={w} height={h} className="coverage-svg">
        <defs>
          <path id="cov-sphere" d={pathGen({ type: "Sphere" }) ?? ""} />
          <clipPath id="cov-clip">
            <use href="#cov-sphere" />
          </clipPath>
        </defs>
        <use href="#cov-sphere" className="sky-sphere" />
        <g clipPath="url(#cov-clip)">
          <path className="sky-graticule" d={pathGen(graticule) ?? ""} />
          {features.map((f, i) => (
            <path key={i} d={pathGen(f) ?? ""} className="coverage-cell" />
          ))}
          {points.map((p, i) => {
            const xy = projection([raToLon(p.ra), p.dec]);
            if (!xy) return null;
            return <circle key={i} cx={xy[0]} cy={xy[1]} r={2} className="coverage-dot" />;
          })}
        </g>
      </svg>
      <div className="muted small">
        Each footprint contributes additively to total coverage; overlapping regions are
        counted only once visually (semi-transparent layering).
      </div>
    </div>
  );
}
