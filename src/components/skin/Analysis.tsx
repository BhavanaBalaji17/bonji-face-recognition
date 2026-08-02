import { ScoreRing } from "./ScoreRing";
import { ProductCard } from "./ProductCard";
import type { AnalysisResult, Metric } from "@/lib/analysis-api";

function severityLabel(score: number, positive?: boolean) {
  const good = positive ? score >= 65 : score <= 30;
  const mid = positive ? score >= 45 : score <= 50;
  if (good) return positive ? "Excellent" : "Low";
  if (mid) return "Moderate";
  return positive ? "Needs care" : "Elevated";
}

function MetricGrid({ items }: { items: Metric[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((metric, i) => (
        <article
          key={metric.key}
          className="animate-rise-in rounded-3xl border border-border/70 bg-card p-6 shadow-soft transition-smooth hover:-translate-y-1 hover:shadow-lift"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-display text-lg">{metric.label}</h4>
              <span className="mt-1 inline-flex rounded-full bg-primary-soft px-3 py-1 text-[11px] font-medium tracking-wide text-primary-foreground">
                {severityLabel(metric.score, metric.positive)}
              </span>
            </div>
            <ScoreRing value={metric.score} tone={metric.positive ? "leaf" : "primary"} />
          </div>
          {metric.note ? (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{metric.note}</p>
          ) : null}
          {typeof metric.confidence === "number" ? (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground/90">
                <span>Confidence</span>
                <span>{metric.confidence}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary-gradient transition-smooth"
                  style={{ width: `${metric.confidence}%` }}
                />
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function Analysis({ result }: { result: AnalysisResult }) {
  return (
    <div className="space-y-14">
      <section className="animate-rise-in rounded-4xl border border-border/70 bg-card-gradient p-7 shadow-soft sm:p-10">
        <div className="flex flex-col items-center gap-8 text-center sm:flex-row sm:text-left">
          {result.overall ? (
            <div className="relative">
              <span className="absolute inset-0 rounded-full bg-primary/30 animate-pulse-ring" />
              <ScoreRing value={result.overall.score} size={140} stroke={12} tone="leaf" label="Overall" />
            </div>
          ) : null}
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Analysis complete</p>
            <h2 className="text-3xl sm:text-4xl">Your results</h2>
            {result.summary ? (
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">{result.summary}</p>
            ) : null}
            {result.concerns.length ? (
              <ul className="flex flex-wrap gap-2 pt-1">
                {result.concerns.map((concern) => (
                  <li
                    key={concern}
                    className="rounded-full bg-ivory/80 px-3 py-1 text-[11px] font-medium text-foreground"
                  >
                    {concern}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      {result.skin.length ? (
        <section>
          <h3 className="mb-6 text-2xl">Skin analysis</h3>
          <MetricGrid items={result.skin} />
        </section>
      ) : null}

      {result.hair.length ? (
        <section>
          <h3 className="mb-6 text-2xl">Hair analysis</h3>
          <MetricGrid items={result.hair} />
        </section>
      ) : null}

      {result.products.length ? (
        <section>
          <div className="mb-6">
            <h3 className="text-2xl">Recommended Products</h3>
            <p className="mt-1 text-sm text-muted-foreground">Selected for you based on your analysis results.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {result.products.map((product, i) => (
              <ProductCard key={product.id} product={product} index={i} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
