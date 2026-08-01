import { useEffect, useState } from "react";

type Props = {
  value: number;
  size?: number;
  stroke?: number;
  tone?: "primary" | "leaf";
  label?: string;
};

export function ScoreRing({ value, size = 84, stroke = 8, tone = "primary", label }: Props) {
  const [progress, setProgress] = useState(0);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    const id = window.setTimeout(() => setProgress(value), 120);
    return () => window.clearTimeout(id);
  }, [value]);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={tone === "leaf" ? "stroke-leaf-soft" : "stroke-primary"}
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: circumference - (progress / 100) * circumference,
            transition: "stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-lg leading-none text-foreground">{value}%</span>
        {label ? <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span> : null}
      </div>
    </div>
  );
}
