import { useEffect, useState } from "react";
import type { ImageDetail, ImageUserMeta } from "../../shared/ipc";
import { thumbUrl } from "../lib/thumb";

type FormState = {
  totalIntegrationS: string;
  filters: string;
  telescope: string;
  camera: string;
  mount: string;
  bortle: string;
  frameCount: string;
  palette: string;
  notes: string;
};

function metaToForm(d: ImageDetail): FormState {
  const m = d.userMeta;
  return {
    totalIntegrationS: m.totalIntegrationS != null ? String(m.totalIntegrationS) : "",
    filters: m.filters ? m.filters.join(", ") : "",
    telescope: m.telescope ?? "",
    camera: m.camera ?? "",
    mount: m.mount ?? "",
    bortle: m.bortle != null ? String(m.bortle) : "",
    frameCount: m.frameCount != null ? String(m.frameCount) : "",
    palette: m.palette ?? "",
    notes: d.userNotes ?? "",
  };
}

function parseNum(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function MetadataPanel({
  detail,
  onSaved,
  onDelete,
}: {
  detail: ImageDetail;
  onSaved: () => Promise<void> | void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => metaToForm(detail));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(metaToForm(detail));
  }, [detail.id, detail]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const meta: Partial<ImageUserMeta> = {
        totalIntegrationS: parseNum(form.totalIntegrationS),
        filters: form.filters
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        telescope: form.telescope.trim() || null,
        camera: form.camera.trim() || null,
        mount: form.mount.trim() || null,
        bortle: parseNum(form.bortle),
        frameCount: parseNum(form.frameCount),
        palette: form.palette.trim() || null,
      };
      await window.zenith.updateImageMeta(detail.id, meta);
      await window.zenith.updateImageNotes(detail.id, form.notes.trim() || null);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="meta-panel">
      <div className="meta-preview">
        {detail.thumbPath && <img src={thumbUrl(detail.thumbPath)!} alt="" />}
      </div>

      <section>
        <h3>File</h3>
        <dl>
          <dt>Format</dt><dd>{detail.format ?? "—"}</dd>
          <dt>Dimensions</dt>
          <dd>
            {detail.widthPx && detail.heightPx
              ? `${detail.widthPx} × ${detail.heightPx}`
              : "—"}
          </dd>
          <dt>Imported</dt><dd>{detail.importedAt}</dd>
        </dl>
      </section>

      <section>
        <h3>Sky position</h3>
        <dl>
          <dt>RA / Dec</dt>
          <dd>
            {detail.raDeg != null && detail.decDeg != null
              ? `${detail.raDeg.toFixed(4)}°, ${detail.decDeg.toFixed(4)}°`
              : "not solved"}
          </dd>
          <dt>FOV</dt>
          <dd>
            {detail.fovWDeg && detail.fovHDeg
              ? `${detail.fovWDeg.toFixed(3)}° × ${detail.fovHDeg.toFixed(3)}°`
              : "—"}
          </dd>
        </dl>
      </section>

      <section>
        <h3>Acquisition details</h3>
        <div className="field">
          <label>Total integration (seconds)</label>
          <input value={form.totalIntegrationS} onChange={set("totalIntegrationS")} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Filters (comma-separated)</label>
          <input value={form.filters} onChange={set("filters")} placeholder="L, R, G, B, Hα" />
        </div>
        <div className="field">
          <label>Frame count</label>
          <input value={form.frameCount} onChange={set("frameCount")} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Palette</label>
          <input value={form.palette} onChange={set("palette")} placeholder="LRGB / SHO / HOO / OSC" />
        </div>
        <div className="field">
          <label>Telescope</label>
          <input value={form.telescope} onChange={set("telescope")} />
        </div>
        <div className="field">
          <label>Camera</label>
          <input value={form.camera} onChange={set("camera")} />
        </div>
        <div className="field">
          <label>Mount</label>
          <input value={form.mount} onChange={set("mount")} />
        </div>
        <div className="field">
          <label>Bortle</label>
          <input value={form.bortle} onChange={set("bortle")} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea value={form.notes} onChange={set("notes")} rows={3} />
        </div>
      </section>

      <div className="meta-actions">
        <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
