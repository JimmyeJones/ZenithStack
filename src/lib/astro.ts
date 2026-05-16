import * as Astronomy from "astronomy-engine";
import type { ImageRow, SiteRow } from "../../shared/ipc";

export type AltSample = { t: Date; alt: number; az: number };

export type TargetTrack = {
  image: ImageRow;
  samples: AltSample[];
  rise: Date | null;
  transit: Date | null;
  set: Date | null;
  maxAlt: number;
};

const STEP_MIN = 10;

function observer(site: SiteRow): Astronomy.Observer {
  return new Astronomy.Observer(site.lat, site.lon, site.elevationM ?? 0);
}

function horizon(date: Date, obs: Astronomy.Observer, ra: number, dec: number) {
  const raHours = ra / 15;
  const h = Astronomy.Horizon(date, obs, raHours, dec, "normal");
  return { alt: h.altitude, az: h.azimuth };
}

export function nightWindow(date: Date, site: SiteRow): { start: Date; end: Date } {
  const obs = observer(site);
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const dusk = Astronomy.SearchAltitude(
    Astronomy.Body.Sun, obs, -1, noon, 1, -0.833,
  );
  const dawn = Astronomy.SearchAltitude(
    Astronomy.Body.Sun, obs, +1,
    dusk ? dusk.date : new Date(noon.getTime() + 6 * 3600_000),
    1, -0.833,
  );
  return {
    start: dusk ? dusk.date : new Date(noon.getTime() + 5 * 3600_000),
    end: dawn ? dawn.date : new Date(noon.getTime() + 19 * 3600_000),
  };
}

export function sunAltitude(date: Date, site: SiteRow): number {
  const obs = observer(site);
  const eq = Astronomy.Equator(Astronomy.Body.Sun, date, obs, true, true);
  return Astronomy.Horizon(date, obs, eq.ra, eq.dec, "normal").altitude;
}

export function moonAltitude(date: Date, site: SiteRow): { alt: number; az: number } {
  const obs = observer(site);
  const eq = Astronomy.Equator(Astronomy.Body.Moon, date, obs, true, true);
  const h = Astronomy.Horizon(date, obs, eq.ra, eq.dec, "normal");
  return { alt: h.altitude, az: h.azimuth };
}

export function moonPhase(date: Date): number {
  return Astronomy.MoonPhase(date);
}

export function moonIllumination(date: Date): number {
  return Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction;
}

export function tracksForNight(
  images: ImageRow[],
  site: SiteRow,
  start: Date,
  end: Date,
): TargetTrack[] {
  const obs = observer(site);
  const steps: Date[] = [];
  const stepMs = STEP_MIN * 60_000;
  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    steps.push(new Date(t));
  }

  return images
    .filter((img) => img.raDeg != null && img.decDeg != null)
    .map((img) => {
      let maxAlt = -90;
      let transit: Date | null = null;
      const samples = steps.map((t) => {
        const h = horizon(t, obs, img.raDeg!, img.decDeg!);
        if (h.alt > maxAlt) {
          maxAlt = h.alt;
          transit = t;
        }
        return { t, alt: h.alt, az: h.az };
      });

      let rise: Date | null = null;
      let setTime: Date | null = null;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        if (a.alt < 0 && b.alt >= 0 && !rise) rise = interpZero(a, b);
        if (a.alt >= 0 && b.alt < 0 && !setTime) setTime = interpZero(a, b);
      }

      return { image: img, samples, rise, transit, set: setTime, maxAlt };
    })
    .sort((a, b) => b.maxAlt - a.maxAlt);
}

function interpZero(a: AltSample, b: AltSample): Date {
  const f = a.alt / (a.alt - b.alt);
  return new Date(a.t.getTime() + f * (b.t.getTime() - a.t.getTime()));
}

export function twilightBoundaries(
  date: Date,
  site: SiteRow,
): {
  sunset: Date | null;
  civilEnd: Date | null;
  nauticalEnd: Date | null;
  astroEnd: Date | null;
  astroStart: Date | null;
  nauticalStart: Date | null;
  civilStart: Date | null;
  sunrise: Date | null;
} {
  const obs = observer(site);
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);

  const find = (dir: 1 | -1, alt: number, from: Date): Date | null => {
    const r = Astronomy.SearchAltitude(
      Astronomy.Body.Sun, obs, dir, from, 1, alt,
    );
    return r ? r.date : null;
  };

  const sunset = find(-1, -0.833, noon);
  const civilEnd = find(-1, -6, noon);
  const nauticalEnd = find(-1, -12, noon);
  const astroEnd = find(-1, -18, noon);
  const astroStart = find(+1, -18, astroEnd ?? noon);
  const nauticalStart = find(+1, -12, nauticalEnd ?? noon);
  const civilStart = find(+1, -6, civilEnd ?? noon);
  const sunrise = find(+1, -0.833, sunset ?? noon);

  return {
    sunset, civilEnd, nauticalEnd, astroEnd,
    astroStart, nauticalStart, civilStart, sunrise,
  };
}
