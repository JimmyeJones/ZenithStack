import { useEffect, useState, useCallback } from "react";
import type { ImageDetail, ImageRow } from "../../shared/ipc";
import { thumbUrl } from "../lib/thumb";
import { MetadataPanel } from "../components/MetadataPanel";

export function Library() {
  const [images, setImages] = useState<ImageRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setImages(await window.zenith.listImages());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    window.zenith.getImage(selectedId).then(setDetail);
  }, [selectedId]);

  const handleImport = async () => {
    setError(null);
    const paths = await window.zenith.pickImageFiles();
    if (paths.length === 0) return;
    setImporting(true);
    try {
      const result = await window.zenith.importImages(paths);
      if (result.errors.length > 0) {
        setError(
          result.errors
            .map((e) => `${e.path.split(/[\\/]/).pop()}: ${e.message}`)
            .join("\n"),
        );
      }
      await refresh();
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: number) => {
    await window.zenith.deleteImage(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  };

  return (
    <div className="library">
      <div className="library-grid-col">
        <div className="library-toolbar">
          <button onClick={handleImport} disabled={importing}>
            {importing ? "Importing…" : "Import images"}
          </button>
          <span className="muted">{images.length} images</span>
        </div>
        {error && <pre className="error">{error}</pre>}
        <div className="grid">
          {images.map((img) => (
            <button
              key={img.id}
              className={`thumb ${selectedId === img.id ? "selected" : ""}`}
              onClick={() => setSelectedId(img.id)}
            >
              {img.thumbPath ? (
                <img src={thumbUrl(img.thumbPath)!} alt="" />
              ) : (
                <div className="thumb-placeholder">no preview</div>
              )}
            </button>
          ))}
          {images.length === 0 && (
            <div className="empty muted">
              No images yet. Click "Import images" to add finals.
            </div>
          )}
        </div>
      </div>
      <aside className="library-detail-col">
        {detail ? (
          <MetadataPanel
            detail={detail}
            onSaved={async () => {
              setDetail(await window.zenith.getImage(detail.id));
            }}
            onDelete={() => handleDelete(detail.id)}
          />
        ) : (
          <div className="muted">Select an image to view details.</div>
        )}
      </aside>
    </div>
  );
}
