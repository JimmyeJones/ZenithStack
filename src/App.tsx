import { useEffect, useState } from "react";
import type { AppInfo } from "../shared/ipc";

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.zenith
      .getAppInfo()
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="app">
      <header>
        <h1>ZenithStack</h1>
        <span className="muted">milestone 1 · skeleton</span>
      </header>
      <main>
        <div className="card">
          <h2>Environment</h2>
          {error && <pre>error: {error}</pre>}
          {info && (
            <pre>
{`version:   ${info.appVersion}
platform:  ${info.platform}
db path:   ${info.dbPath}
images:    ${info.imageCount}`}
            </pre>
          )}
          {!info && !error && <pre>loading…</pre>}
        </div>
      </main>
    </div>
  );
}
