import { useEffect, useState } from "react";
import type { AppInfo } from "../shared/ipc";
import { Library } from "./views/Library";
import { SkyPlot } from "./views/SkyPlot";
import { Analytics } from "./views/Analytics";
import { Planner } from "./views/Planner";
import { SettingsModal } from "./components/SettingsModal";

type Tab = "library" | "sky" | "planner" | "analytics";

export function App() {
  const [tab, setTab] = useState<Tab>("library");
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        <button className="tab" onClick={() => setSettingsOpen(true)}>Settings</button>
      </header>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <main>
        {tab === "library" && <Library />}
        {tab === "sky" && <SkyPlot />}
        {tab === "planner" && <Planner />}
        {tab === "analytics" && <Analytics />}
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

