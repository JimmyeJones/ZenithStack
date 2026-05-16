import type { Feature, Polygon } from "geojson";

export type FootprintFeature = Feature<
  Polygon,
  { imageId: number; importedAt: string; thumbPath: string | null }
>;

export function raToLon(ra: number): number {
  let lon = 180 - ra;
  while (lon < -180) lon += 360;
  while (lon > 180) lon -= 360;
  return lon;
}

export function buildFootprintFeature(
  imageId: number,
  importedAt: string,
  thumbPath: string | null,
  geojson: string,
): FootprintFeature | null {
  let parsed: Polygon;
  try {
    parsed = JSON.parse(geojson) as Polygon;
  } catch {
    return null;
  }
  if (parsed.type !== "Polygon" || !parsed.coordinates[0]) return null;

  const transformed = parsed.coordinates.map((ring) =>
    ring.map(([ra, dec]) => [raToLon(ra), dec] as [number, number]),
  );

  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: transformed },
    properties: { imageId, importedAt, thumbPath },
  };
}

export function footprintCentroidLonLat(geojson: string): [number, number] | null {
  let parsed: Polygon;
  try {
    parsed = JSON.parse(geojson) as Polygon;
  } catch {
    return null;
  }
  const ring = parsed.coordinates[0];
  if (!ring || ring.length === 0) return null;
  let raSum = 0;
  let decSum = 0;
  for (const [ra, dec] of ring) {
    raSum += ra;
    decSum += dec;
  }
  return [raToLon(raSum / ring.length), decSum / ring.length];
}
