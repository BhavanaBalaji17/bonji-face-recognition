import { ScoreRing } from "./ScoreRing";
import { ProductCard } from "./ProductCard";
import { metrics, placeholderProducts, type Product } from "./data";


function severityLabel(score: number, positive?: boolean) {
  const good = positive ? score >= 65 : score <= 30;
  const mid = positive ? score >= 45 : score <= 50;
  if (good) return positive ? "Excellent" : "Low";
  if (mid) return "Moderate";
  return positive ? "Needs care" : "Elevated";
}

export function Analysis() {
  const overall = metrics.find((m) => m.key === "health")!;

  return (
    <div className="space-y-14">
      <section className="animate-rise-in rounded-4xl border border-border/70 bg-card-gradient p-7 shadow-soft sm:p-10">
        <div className="flex flex-col items-center gap-8 text-center sm:flex-row sm:text-left">
          <div className="relative">
            <span className="absolute inset-0 rounded-full bg-primary/30 animate-pulse-ring" />
            <ScoreRing value={overall.score} size={140} stroke={12} tone="leaf" label="Overall" />
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Analysis complete</p>
            <h2 className="text-3xl sm:text-4xl">Your skin looks balanced and healthy</h2>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              We analysed 10 skin signals across your face. Hydration and barrier health are strong — focus on
              pigmentation and under-eye care for the next four weeks.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-6 text-2xl">Detected skin concerns</h3>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {metrics.map((metric, i) => (
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
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{metric.note}</p>
              <p className="mt-3 text-xs text-muted-foreground/80">Confidence {metric.confidence}%</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-2xl">Recommended Bonji products</h3>
          <p className="text-sm text-muted-foreground">Curated for your results</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {products.map((product, i) => (
            <article
              key={product.name}
              className="animate-rise-in group overflow-hidden rounded-4xl border border-border/70 bg-card shadow-soft transition-smooth hover:-translate-y-1.5 hover:shadow-lift"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <div className="overflow-hidden bg-cream">
                <img
                  src={product.image}
                  alt={product.name}
                  loading="lazy"
                  width={768}
                  height={768}
                  className="h-56 w-full object-cover transition-smooth group-hover:scale-105"
                />
              </div>
              <div className="space-y-4 p-6">
                <h4 className="font-display text-xl">{product.name}</h4>
                <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>
                <ul className="flex flex-wrap gap-2">
                  {product.benefits.map((benefit) => (
                    <li
                      key={benefit}
                      className="rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-accent-foreground"
                    >
                      {benefit}
                    </li>
                  ))}
                </ul>
                <button className="w-full rounded-full bg-primary-gradient px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-smooth hover:brightness-105 active:scale-[0.98]">
                  View Product
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
