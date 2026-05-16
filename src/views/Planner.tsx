import { useEffect, useMemo, useState } from "react";
import type { ImageRow, SiteRow } from "../../shared/ipc";
import {
  moonAltitude,
  moonIllumination,
  nightWindow,
  tracksForNight,
  twilightBoundaries,
  type TargetTrack,
} from "../lib/astro";
import { thumbUrl } from "../lib/thumb";

const W = 1080;
const H = 380;
const PAD = { top: 20, right: 20, bottom: 30, left: 50 };

export function Planner() {
  const [images, setImages] = useState<ImageRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [dateStr, setDateStr] = useState<string>(todayLocalISO());
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [hoverId, setHoverId] = useState<number | null>(null);

  useEffect(() => {
    window.zenith.listImages().then(setImages);
    refreshSites();
  }, []);

  const refreshSites = async () => {
    const list = await window.zenith.listSites();
    setSites(list);
    if (list.length > 0 && siteId == null) setSiteId(list[0].id);
  };

  const site = sites.find((s) => s.id === siteId) ?? null;
  const date = useMemo(() => new Date(`${dateStr}T12:00:00`), [dateStr]);

  const window_ = useMemo(() => {
    if (!site) return null;
    try {
      return nightWindow(date, site);
    } catch {
      return null;
    }
  }, [site, date]);

  const tracks = useMemo(() => {
    if (!site || !window_) return [];
    return tracksForNight(images, site, window_.start, window_.end);
  }, [images, site, window_]);

  const moonTrack = useMemo(() => {
    if (!site || !window_) return [];
    const out: { t: Date; alt: number }[] = [];
    for (let t = window_.start.getTime(); t <= window_.end.getTime(); t += 10 * 60_000) {
      const d = new Date(t);
      out.push({ t: d, alt: moonAltitude(d, site).alt });
    }
    return out;
  }, [site, window_]);

  const twilight = useMemo(() => {
    if (!site) return null;
    try {
      return twilightBoundaries(date, site);
    } catch {
      return null;
    }
  }, [site, date]);

  const moonIllum = useMemo(() => moonIllumination(date), [date]);

  return (
    <div className="planner">
      <div className="planner-toolbar">
        <label>
          Site:
          <select
            value={siteId ?? ""}
            onChange={(e) => setSiteId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— select —</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setShowSiteForm(true)}>+ Site</button>
        <label>
          Night of:
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </label>
        <span className="muted spacer">
          Moon: {(moonIllum * 100).toFixed(0)}% illuminated
        </span>
      </div>

      {showSiteForm && (
        <SiteForm
          existing={null}
          onSaved={async () => {
            setShowSiteForm(false);
            await refreshSites();
          }}
          onCancel={() => setShowSiteForm(false)}
        />
      )}

      {!site ? (
        <div className="empty muted">
          Add an observing site to plan a night.
        </div>
      ) : !window_ ? (
        <div className="empty muted">
          Sun stays above the horizon all "night" at this site/date — try another date.
        </div>
      ) : (
        <>
          <AltChart
            site={site}
            startT={window_.start}
            endT={window_.end}
            tracks={tracks}
            moonTrack={moonTrack}
            twilight={twilight}
            hoverId={hoverId}
            setHoverId={setHoverId}
          />
          <TrackTable tracks={tracks} hoverId={hoverId} setHoverId={setHoverId} />
        </>
      )}
    </div>
  );
}

function AltChart({
  startT, endT, tracks, moonTrack, twilight, hoverId, setHoverId,
}: {
  site: SiteRow;
  startT: Date;
  endT: Date;
  tracks: TargetTrack[];
  moonTrack: { t: Date; alt: number }[];
  twilight: ReturnType<typeof twilightBoundaries> | null;
  hoverId: number | null;
  setHoverId: (id: number | null) => void;
}) {
  const x = (t: Date) =>
    PAD.left +
    ((t.getTime() - startT.getTime()) / (endT.getTime() - startT.getTime())) *
      (W - PAD.left - PAD.right);
  const y = (alt: number) =>
    PAD.top + ((90 - Math.max(0, alt)) / 90) * (H - PAD.top - PAD.bottom);

  const band = (a: Date | null, b: Date | null, cls: string) => {
    if (!a || !b) return null;
    const x1 = clamp(x(a), PAD.left, W - PAD.right);
    const x2 = clamp(x(b), PAD.left, W - PAD.right);
    return (
      <rect
        x={Math.min(x1, x2)}
        y={PAD.top}
        width={Math.abs(x2 - x1)}
        height={H - PAD.top - PAD.bottom}
        className={cls}
      />
    );
  };

  const hourTicks: Date[] = [];
  const startHour = new Date(startT);
  startHour.setMinutes(0, 0, 0);
  for (
    let t = startHour.getTime();
    t <= endT.getTime();
    t += 3600_000
  ) {
    if (t >= startT.getTime()) hourTicks.push(new Date(t));
  }

  return (
    <svg width={W} height={H} className="alt-chart">
      <rect x={PAD.left} y={PAD.top}
        width={W - PAD.left - PAD.right}
        height={H - PAD.top - PAD.bottom}
        className="chart-bg" />

      {twilight && (
        <>
          {band(twilight.sunset, twilight.civilEnd, "twilight civil")}
          {band(twilight.civilEnd, twilight.nauticalEnd, "twilight nautical")}
          {band(twilight.nauticalEnd, twilight.astroEnd, "twilight astro")}
          {band(twilight.astroStart, twilight.nauticalStart, "twilight nautical")}
          {band(twilight.nauticalStart, twilight.civilStart, "twilight civil")}
          {band(twilight.civilStart, twilight.sunrise, "twilight day")}
        </>
      )}

      {[0, 30, 60, 90].map((alt) => (
        <g key={alt}>
          <line
            x1={PAD.left} x2={W - PAD.right}
            y1={y(alt)} y2={y(alt)}
            className="grid"
          />
          <text x={PAD.left - 6} y={y(alt) + 3} className="axis-label">
            {alt}°
          </text>
        </g>
      ))}

      {hourTicks.map((t) => (
        <g key={t.toISOString()}>
          <line x1={x(t)} x2={x(t)} y1={H - PAD.bottom} y2={H - PAD.bottom + 4}
            className="grid" />
          <text x={x(t)} y={H - PAD.bottom + 16} className="axis-label tick">
            {t.getHours().toString().padStart(2, "0")}:00
          </text>
        </g>
      ))}

      <path
        d={`M ${moonTrack.map((p) => `${x(p.t)} ${y(p.alt)}`).join(" L ")}`}
        className="moon-curve"
      />

      {tracks.map((tr) => {
        const isHover = hoverId === tr.image.id;
        const visible = tr.samples.filter((s) => s.alt > 0);
        if (visible.length < 2) return null;
        return (
          <path
            key={tr.image.id}
            d={`M ${visible.map((p) => `${x(p.t)} ${y(p.alt)}`).join(" L ")}`}
            className={`target-curve ${isHover ? "hover" : ""}`}
            onMouseEnter={() => setHoverId(tr.image.id)}
            onMouseLeave={() => setHoverId(null)}
          />
        );
      })}
    </svg>
  );
}

function TrackTable({
  tracks, hoverId, setHoverId,
}: {
  tracks: TargetTrack[];
  hoverId: number | null;
  setHoverId: (id: number | null) => void;
}) {
  if (tracks.length === 0) {
    return <div className="muted small">No solved images to plan.</div>;
  }
  return (
    <div className="track-table">
      <div className="track-header">
        <div></div>
        <div>RA / Dec</div>
        <div>Max alt</div>
        <div>Rise</div>
        <div>Transit</div>
        <div>Set</div>
      </div>
      {tracks.map((tr) => (
        <div
          key={tr.image.id}
          className={`track-row ${hoverId === tr.image.id ? "hover" : ""}`}
          onMouseEnter={() => setHoverId(tr.image.id)}
          onMouseLeave={() => setHoverId(null)}
        >
          <div className="track-thumb">
            {tr.image.thumbPath && <img src={thumbUrl(tr.image.thumbPath)!} alt="" />}
          </div>
          <div className="muted small">
            {tr.image.raDeg!.toFixed(2)}°, {tr.image.decDeg!.toFixed(2)}°
          </div>
          <div>{tr.maxAlt.toFixed(0)}°</div>
          <div>{fmtTime(tr.rise)}</div>
          <div>{fmtTime(tr.transit)}</div>
          <div>{fmtTime(tr.set)}</div>
        </div>
      ))}
    </div>
  );
}

function SiteForm({
  existing, onSaved, onCancel,
}: {
  existing: SiteRow | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [lat, setLat] = useState(existing ? String(existing.lat) : "");
  const [lon, setLon] = useState(existing ? String(existing.lon) : "");
  const [elev, setElev] = useState(existing?.elevationM != null ? String(existing.elevationM) : "");

  const save = async () => {
    const latN = Number(lat);
    const lonN = Number(lon);
    if (!name || !Number.isFinite(latN) || !Number.isFinite(lonN)) return;
    const payload = {
      name: name.trim(),
      lat: latN,
      lon: lonN,
      elevationM: elev ? Number(elev) : null,
      tz: null,
    };
    if (existing) await window.zenith.updateSite({ ...existing, ...payload });
    else await window.zenith.createSite(payload);
    onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{existing ? "Edit site" : "Add observing site"}</h2>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Backyard" />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Latitude (deg, N+)</label>
            <input value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Longitude (deg, E+)</label>
            <input value={lon} onChange={(e) => setLon(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Elevation (m, optional)</label>
          <input value={elev} onChange={(e) => setElev(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={save}>{existing ? "Save" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}

function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Re-export so the chart wrapper can type-check its prop
export type { twilightBoundaries };
