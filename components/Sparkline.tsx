export function Sparkline({
  data,
  width = 40,
  height = 16,
  color = "#7c5cff",
  responsive = false,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Stretch to the container's full width; the stroke stays crisp via non-scaling-stroke. */
  responsive?: boolean;
}) {
  if (!data.length) return <svg width={width} height={height} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const poly = (
    <polyline
      points={points.join(" ")}
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect={responsive ? "non-scaling-stroke" : undefined}
    />
  );
  if (responsive) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
        {poly}
      </svg>
    );
  }
  return (
    <svg width={width} height={height} className="inline-block shrink-0">
      {poly}
    </svg>
  );
}
