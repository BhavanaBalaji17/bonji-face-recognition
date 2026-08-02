import type { Product } from "@/lib/analysis-api";

type Props = { product: Product; index?: number };

export function ProductCard({ product, index = 0 }: Props) {
  return (
    <article
      className="animate-rise-in group flex h-full flex-col overflow-hidden rounded-4xl border border-border/70 bg-card shadow-soft transition-smooth hover:-translate-y-1.5 hover:shadow-lift"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-cream">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-smooth group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-card-gradient">
            <span className="rounded-full border border-dashed border-border px-4 py-2 text-xs tracking-wide text-muted-foreground">
              No image
            </span>
          </div>
        )}
        {product.concern ? (
          <span className="absolute left-4 top-4 rounded-full bg-ivory/85 px-3 py-1 text-[11px] font-medium text-foreground backdrop-blur">
            {product.concern}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <h4 className="font-display text-xl">{product.name}</h4>
          {product.price ? <span className="text-sm font-semibold text-foreground">{product.price}</span> : null}
        </div>

        {product.description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>
        ) : null}

        {product.ingredients.length ? (
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Key ingredients</p>
            <p className="mt-1 text-sm text-foreground">{product.ingredients.join(" · ")}</p>
          </div>
        ) : null}

        {product.benefits.length ? (
          <ul className="flex flex-wrap gap-2">
            {product.benefits.map((benefit, i) => (
              <li
                key={`${benefit}-${i}`}
                className="rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-accent-foreground"
              >
                {benefit}
              </li>
            ))}
          </ul>
        ) : null}

        <a
          href={product.url ?? "#"}
          target={product.url ? "_blank" : undefined}
          rel={product.url ? "noreferrer" : undefined}
          className="mt-auto w-full rounded-full bg-primary-gradient px-5 py-3 text-center text-sm font-semibold text-primary-foreground shadow-glow transition-smooth hover:brightness-105 active:scale-[0.98]"
        >
          View Product
        </a>
      </div>
    </article>
  );
}
