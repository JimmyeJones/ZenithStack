import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, extname, join, basename } from "node:path";
import { readFitsHeader, type FitsHeader } from "./fits";

export type SolverKind = "astap" | "astrometry-net";

export type SolverHint = {
  fovDeg?: number;
  raDeg?: number;
  decDeg?: number;
  radiusDeg?: number;
};

export type SolveResult = {
  solver: SolverKind;
  header: FitsHeader;
  naxis1: number;
  naxis2: number;
  log: string;
};

export class SolverError extends Error {
  constructor(message: string, public readonly log: string) {
    super(message);
  }
}

export async function solve(
  kind: SolverKind,
  binPath: string,
  imagePath: string,
  hint: SolverHint,
): Promise<SolveResult> {
  if (!binPath) throw new SolverError(`${kind} binary path not configured`, "");
  if (!existsSync(binPath)) throw new SolverError(`binary not found: ${binPath}`, "");
  if (!existsSync(imagePath)) throw new SolverError(`image not found: ${imagePath}`, "");

  if (kind === "astap") return solveAstap(binPath, imagePath, hint);
  return solveAstrometryNet(binPath, imagePath, hint);
}

async function solveAstap(
  binPath: string,
  imagePath: string,
  hint: SolverHint,
): Promise<SolveResult> {
  const args: string[] = ["-f", imagePath, "-wcs"];
  if (hint.fovDeg && hint.fovDeg > 0) args.push("-fov", String(hint.fovDeg));
  else args.push("-fov", "0");
  if (hint.raDeg != null && hint.decDeg != null) {
    args.push("-ra", String(hint.raDeg / 15));
    args.push("-spd", String(hint.decDeg + 90));
  }
  if (hint.radiusDeg) args.push("-r", String(hint.radiusDeg));

  const log = await runProcess(binPath, args);
  const wcsPath = stripExt(imagePath) + ".wcs";
  if (!existsSync(wcsPath)) {
    throw new SolverError("ASTAP did not produce a .wcs file", log);
  }
  const info = await readFitsHeader(wcsPath);
  await rm(wcsPath, { force: true });
  const iniPath = stripExt(imagePath) + ".ini";
  if (existsSync(iniPath)) await rm(iniPath, { force: true });
  return {
    solver: "astap",
    header: info.header,
    naxis1: numericHeader(info.header, "NAXIS1") ?? info.naxis1,
    naxis2: numericHeader(info.header, "NAXIS2") ?? info.naxis2,
    log,
  };
}

async function solveAstrometryNet(
  binPath: string,
  imagePath: string,
  hint: SolverHint,
): Promise<SolveResult> {
  const args = [
    "--overwrite",
    "--no-plots",
    "--downsample", "4",
    "--no-verify",
  ];
  if (hint.raDeg != null && hint.decDeg != null) {
    args.push("--ra", String(hint.raDeg));
    args.push("--dec", String(hint.decDeg));
    args.push("--radius", String(hint.radiusDeg ?? 5));
  }
  if (hint.fovDeg && hint.fovDeg > 0) {
    const arcsec = hint.fovDeg * 3600;
    args.push("--scale-low", String(arcsec * 0.5));
    args.push("--scale-high", String(arcsec * 1.5));
    args.push("--scale-units", "arcsecwidth");
  }
  args.push(imagePath);

  const log = await runProcess(binPath, args);
  const wcsPath = stripExt(imagePath) + ".wcs";
  if (!existsSync(wcsPath)) {
    throw new SolverError("solve-field did not produce a .wcs file", log);
  }
  const info = await readFitsHeader(wcsPath);

  for (const ext of [".wcs", ".axy", ".corr", ".match", ".rdls", ".solved",
                      ".xyls", "-indx.xyls", ".new"]) {
    const p = join(dirname(imagePath), basename(imagePath, extname(imagePath)) + ext);
    if (existsSync(p)) await rm(p, { force: true });
  }

  return {
    solver: "astrometry-net",
    header: info.header,
    naxis1: numericHeader(info.header, "IMAGEW") ?? numericHeader(info.header, "NAXIS1") ?? 0,
    naxis2: numericHeader(info.header, "IMAGEH") ?? numericHeader(info.header, "NAXIS2") ?? 0,
    log,
  };
}

function runProcess(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => reject(new SolverError(e.message, out + err)));
    proc.on("close", (code) => {
      const log = out + err;
      if (code !== 0) reject(new SolverError(`exit code ${code}`, log));
      else resolve(log);
    });
  });
}

function stripExt(p: string): string {
  return join(dirname(p), basename(p, extname(p)));
}

function numericHeader(h: FitsHeader, k: string): number | null {
  const v = h.get(k);
  if (typeof v === "number") return v;
  return null;
}
