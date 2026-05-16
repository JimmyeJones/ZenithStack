import { useEffect, useState } from "react";
import type { AppInfo } from "../shared/ipc";
import { Library } from "./views/Library";

type Tab = "library" | "sky" | "planner" | "analytics";

export function App() {
  const [tab, setTab] = useState<Tab>("library");
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.zenith.getAppInfo().then(setInfo);
  }, [tab]);

  return (
    <div className="app">
      <header>
        <h1>ZenithStack</h1>
        <nav className="tabs">
          <TabBtn id="library" current={tab} setTab={setTab}>Library</TabBtn>
          <TabBtn id="sky" current={tab} setTab={setTab}>Sky</TabBtn>
          <TabBtn id="planner" current={tab} setTab={setTab}>Planner</TabBtn>
          <TabBtn id="analytics" current={tab} setTab={setTab}>Analytics</TabBtn>
        </nav>
        <span className="muted spacer">
          {info ? `${info.imageCount} images · v${info.appVersion}` : ""}
        </span>
      </header>
      <main>
        {tab === "library" && <Library />}
        {tab === "sky" && <Placeholder label="Sky plot — milestone 4" />}
        {tab === "planner" && <Placeholder label="Night planner — milestone 7" />}
        {tab === "analytics" && <Placeholder label="Analytics — milestone 6" />}
      </main>
    </div>
  );
}

function TabBtn({
  id, current, setTab, children,
}: {
  id: Tab; current: Tab; setTab: (t: Tab) => void; children: React.ReactNode;
}) {
  return (
    <button
      className={`tab ${current === id ? "active" : ""}`}
      onClick={() => setTab(id)}
    >
      {children}
    </button>
  );
}

function Placeholder({ label }: { label: string }) {
  return <div className="card"><h2>{label}</h2><pre>Coming soon.</pre></div>;
}
