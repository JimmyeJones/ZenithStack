import { useEffect, useState } from "react";
import type { Settings } from "../../shared/ipc";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.zenith.getSettings().then(setSettings);
  }, []);

  const pick = async (key: "astapBinPath" | "astrometryBinPath") => {
    const path = await window.zenith.pickBinary();
    if (path && settings) setSettings({ ...settings, [key]: path });
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await window.zenith.saveSettings(settings);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <section>
          <h3>Plate solvers</h3>
          <p className="muted">
            Install ASTAP or astrometry.net separately, then point ZenithStack at the binary.
          </p>

          <div className="field">
            <label>Preferred solver</label>
            <select
              value={settings.preferredSolver}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  preferredSolver: e.target.value as Settings["preferredSolver"],
                })
              }
            >
              <option value="astap">ASTAP</option>
              <option value="astrometry-net">astrometry.net (solve-field)</option>
            </select>
          </div>

          <div className="field">
            <label>ASTAP binary</label>
            <div className="row">
              <input
                value={settings.astapBinPath ?? ""}
                onChange={(e) =>
                  setSettings({ ...settings, astapBinPath: e.target.value || null })
                }
                placeholder="/path/to/astap"
              />
              <button onClick={() => pick("astapBinPath")}>Browse…</button>
            </div>
          </div>

          <div className="field">
            <label>astrometry.net solve-field binary</label>
            <div className="row">
              <input
                value={settings.astrometryBinPath ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    astrometryBinPath: e.target.value || null,
                  })
                }
                placeholder="/usr/local/bin/solve-field"
              />
              <button onClick={() => pick("astrometryBinPath")}>Browse…</button>
            </div>
          </div>
        </section>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
