import { useEffect, useState } from "react";
import type { RawSessionSummary } from "../../shared/ipc";

export function RawSessions({ imageId }: { imageId: number }) {
  const [sessions, setSessions] = useState<RawSessionSummary[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setSessions(await window.zenith.listRawSessions(imageId));
  };

  useEffect(() => {
    refresh();
  }, [imageId]);

  const link = async () => {
    setError(null);
    const folder = await window.zenith.pickFolder();
    if (!folder) return;
    setScanning(true);
    try {
      const res = await window.zenith.linkRawFolder(imageId, folder);
      if (res.errors.length > 0) {
        setError(`${res.errors.length} files could not be read`);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const unlink = async (id: number) => {
    await window.zenith.unlinkRawSession(id);
    await refresh();
  };

  return (
    <section>
      <h3>Acquisition details (linked raws)</h3>
      {sessions.length === 0 ? (
        <div className="muted small">
          Link a raw frames folder to populate FWHM, altitude, moon, and frame-outcome stats.
        </div>
      ) : (
        <ul className="raw-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <div className="raw-folder" title={s.folderPath}>
                {s.folderPath.split(/[\\/]/).slice(-2).join("/")}
              </div>
              <div className="raw-stats muted">
                {s.frameCount} frames
                {s.rejectedCount > 0 && ` · ${s.rejectedCount} rejected`}
                {s.totalExposureS > 0 &&
                  ` · ${(s.totalExposureS / 3600).toFixed(1)} h`}
              </div>
              <button className="link-btn" onClick={() => unlink(s.id)}>unlink</button>
            </li>
          ))}
        </ul>
      )}
      <button onClick={link} disabled={scanning}>
        {scanning ? "Scanning…" : "Link raw folder"}
      </button>
      {error && <pre className="error">{error}</pre>}
    </section>
  );
}
