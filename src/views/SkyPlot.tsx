import { useEffect, useMemo, useRef, useState } from "react";
import { geoPath, geoGraticule } from "d3-geo";
import { geoAitoff } from "d3-geo-projection";
import type { ImageRow } from "../../shared/ipc";
import {
  buildFootprintFeature,
  footprintCentroidLonLat,
  raToLon,
  type FootprintFeature,
} from "../lib/skyGeom";
import { thumbUrl } from "../lib/thumb";

const PADDING = 24;

export function SkyPlot() {
  const [images, setImages] = useState<ImageRow[]>([]);
  const [size, setSize] = useState({ w: 1000, h: 500 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.zenith.listImages().then(setImages);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.max(400, r.width), h: Math.max(300, r.height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const plotted = useMemo(() => {
    return images
      .filter((img) => img.footprintGeoJson && img.raDeg != null && img.decDeg != null)
      .map((img) => {
        const feat = buildFootprintFeature(
          img.id,
          img.importedAt,
          img.thumbPath,
          img.footprintGeoJson!,
        );
        return feat ? { img, feat } : null;
      })
      .filter((v): v is { img: ImageRow; feat: FootprintFeature } => v !== null)
      .sort((a, b) => a.img.importedAt.localeCompare(b.img.importedAt));
  }, [images]);

  const pointOnly = useMemo(
    () =>
      images.filter(
        (img) =>
          !img.footprintGeoJson && img.raDeg != null && img.decDeg != null,
      ),
    [images],
  );

  const projection = useMemo(() => {
    const w = size.w - PADDING * 2;
    const h = size.h - PADDING * 2;
    return geoAitoff()
      .scale(Math.min(w / (2 * Math.SQRT2), h / Math.SQRT2))
      .translate([size.w / 2, size.h / 2])
      .precision(0.5);
  }, [size]);

  const pathGen = useMemo(() => geoPath(projection), [projection]);
  const graticule = useMemo(() => geoGraticule().step([30, 15])(), []);
  const sphere = useMemo(() => ({ type: "Sphere" as const }), []);
  const ecliptic = useMemo(() => buildEcliptic(), []);
  const galactic = useMemo(() => buildGalactic(), []);

  const selected = selectedId != null
    ? plotted.find((p) => p.img.id === selectedId)?.img
        ?? pointOnly.find((p) => p.id === selectedId)
        ?? null
    : null;

  return (
    <div className="skyplot" ref={containerRef}>
      <svg width={size.w} height={size.h}>
        <defs>
          <path id="sphere-path" d={pathGen(sphere) ?? ""} />
          <clipPath id="sphere-clip">
            <use href="#sphere-path" />
          </clipPath>
        </defs>

        <use href="#sphere-path" className="sky-sphere" />

        <g clipPath="url(#sphere-clip)">
          <path className="sky-graticule" d={pathGen(graticule) ?? ""} />
          <path className="sky-ecliptic" d={pathGen(ecliptic) ?? ""} />
          <path className="sky-galactic" d={pathGen(galactic) ?? ""} />
        </g>

        <g clipPath="url(#sphere-clip)">
          {plotted.map(({ img, feat }) => {
            const d = pathGen(feat) ?? "";
            const isSelected = img.id === selectedId;
            return (
              <path
                key={img.id}
                d={d}
                className={`footprint ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedId(img.id)}
              />
            );
          })}
        </g>

        <g>
          {plotted.map(({ img }) => {
            if (!img.footprintGeoJson) return null;
            const c = footprintCentroidLonLat(img.footprintGeoJson);
            if (!c) return null;
            const xy = projection(c);
            if (!xy) return null;
            return (
              <ThumbDot
                key={img.id}
                x={xy[0]}
                y={xy[1]}
                thumb={img.thumbPath}
                selected={img.id === selectedId}
                onClick={() => setSelectedId(img.id)}
              />
            );
          })}
          {pointOnly.map((img) => {
            const xy = projection([raToLon(img.raDeg!), img.decDeg!]);
            if (!xy) return null;
            return (
              <ThumbDot
                key={img.id}
                x={xy[0]}
                y={xy[1]}
                thumb={img.thumbPath}
                selected={img.id === selectedId}
                onClick={() => setSelectedId(img.id)}
              />
            );
          })}
        </g>

        <g className="ra-labels">
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((ra) => {
            const xy = projection([raToLon(ra), 0]);
            if (!xy) return null;
            return (
              <text key={ra} x={xy[0]} y={xy[1]} dy="-4">
                {ra / 15}h
              </text>
            );
          })}
        </g>
      </svg>

      {selected && (
        <div className="sky-callout">
          <img src={thumbUrl(selected.thumbPath) ?? ""} alt="" />
          <div className="sky-callout-body">
            <div>
              <strong>RA</strong> {selected.raDeg?.toFixed(3)}°{"  "}
              <strong>Dec</strong> {selected.decDeg?.toFixed(3)}°
            </div>
            {selected.fovWDeg && selected.fovHDeg && (
              <div className="muted">
                FOV {selected.fovWDeg.toFixed(2)}° × {selected.fovHDeg.toFixed(2)}°
              </div>
            )}
            <div className="muted">imported {selected.importedAt}</div>
          </div>
          <button onClick={() => setSelectedId(null)}>✕</button>
        </div>
      )}

      <div className="sky-legend muted">
        {plotted.length} footprints · {pointOnly.length} point-only ·
        most recent rendered on top
      </div>
    </div>
  );
}

function ThumbDot({
  x, y, thumb, selected, onClick,
}: {
  x: number; y: number; thumb: string | null; selected: boolean; onClick: () => void;
}) {
  const r = selected ? 14 : 10;
  const url = thumbUrl(thumb);
  if (!url) {
    return (
      <circle cx={x} cy={y} r={r} className={`dot ${selected ? "selected" : ""}`}
        onClick={onClick} />
    );
  }
  const clipId = `dot-clip-${x.toFixed(2)}-${y.toFixed(2)}`;
  return (
    <g style={{ cursor: "pointer" }} onClick={onClick}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={x} cy={y} r={r} />
        </clipPath>
      </defs>
      <image
        href={url}
        x={x - r}
        y={y - r}
        width={r * 2}
        height={r * 2}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio="xMidYMid slice"
      />
      <circle cx={x} cy={y} r={r}
        className={`dot-ring ${selected ? "selected" : ""}`} />
    </g>
  );
}

function buildEcliptic() {
  const eps = 23.4392911 * Math.PI / 180;
  const coords: [number, number][] = [];
  for (let lambda = 0; lambda <= 360; lambda += 2) {
    const l = lambda * Math.PI / 180;
    const ra = Math.atan2(Math.cos(eps) * Math.sin(l), Math.cos(l)) * 180 / Math.PI;
    const dec = Math.asin(Math.sin(eps) * Math.sin(l)) * 180 / Math.PI;
    coords.push([raToLon((ra + 360) % 360), dec]);
  }
  return { type: "LineString" as const, coordinates: coords };
}

function buildGalactic() {
  const coords: [number, number][] = [];
  for (let l = 0; l <= 360; l += 2) {
    const radec = galacticToEquatorial(l, 0);
    coords.push([raToLon(radec[0]), radec[1]]);
  }
  return { type: "LineString" as const, coordinates: coords };
}

function galacticToEquatorial(lDeg: number, bDeg: number): [number, number] {
  const lNcp = 122.93192 * Math.PI / 180;
  const raNgp = 192.85948 * Math.PI / 180;
  const decNgp = 27.12825 * Math.PI / 180;
  const l = lDeg * Math.PI / 180;
  const b = bDeg * Math.PI / 180;
  const sinDec = Math.sin(b) * Math.sin(decNgp) +
    Math.cos(b) * Math.cos(decNgp) * Math.cos(lNcp - l);
  const dec = Math.asin(sinDec);
  const y = Math.cos(b) * Math.sin(lNcp - l);
  const x = Math.sin(b) * Math.cos(decNgp) - Math.cos(b) * Math.sin(decNgp) * Math.cos(lNcp - l);
  const ra = raNgp + Math.atan2(y, x);
  const raDeg = ((ra * 180 / Math.PI) % 360 + 360) % 360;
  return [raDeg, dec * 180 / Math.PI];
}
