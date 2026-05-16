export type BarDatum = { label: string; value: number; sublabel?: string };

export function BarChart({
  data,
  width = 320,
  rowHeight = 22,
  valueFormat = (v) => v.toLocaleString(),
}: {
  data: BarDatum[];
  width?: number;
  rowHeight?: number;
  valueFormat?: (v: number) => string;
}) {
  if (data.length === 0) {
    return <div className="muted">No data.</div>;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  const labelW = 110;
  const valueW = 60;
  const barW = width - labelW - valueW - 16;

  return (
    <div className="bars">
      {data.map((d) => (
        <div className="bar-row" key={d.label} style={{ height: rowHeight }}>
          <div className="bar-label" style={{ width: labelW }} title={d.label}>
            {d.label}
          </div>
          <div className="bar-track" style={{ width: barW }}>
            <div
              className="bar-fill"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
          <div className="bar-value" style={{ width: valueW }}>
            {valueFormat(d.value)}
            {d.sublabel && <span className="muted"> {d.sublabel}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
