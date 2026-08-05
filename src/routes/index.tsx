import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import logo from "@/assets/bonji-logo.png";
import botanical from "@/assets/botanical-bg.png";
import { Analysis } from "@/components/skin/Analysis";
import { buildAnalysis, fetchRecommendations, type AnalysisResult } from "@/lib/analysis-api";
import { getBonjiCatalog } from "@/lib/bonji-catalog.functions";
import type { BonjiProduct } from "@/lib/bonji-catalog-types";
import { resolveProducts } from "@/lib/catalog-match";
import { scanImageDataUrl } from "@/lib/scanner-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bonji AI Skin Analysis — Personalised Skin Assessment" },
      {
        name: "description",
        content:
          "Upload a selfie or use your camera for an instant AI skin analysis: acne, pigmentation, hydration and more, with Bonji product recommendations.",
      },
      { property: "og:title", content: "Bonji AI Skin Analysis — Personalised Skin Assessment" },
      {
        property: "og:description",
        content: "Upload a selfie or use your camera for an instant AI skin analysis: acne, pigmentation, hydration and more, with Bonji product recommendations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Stage = "idle" | "ready" | "analyzing" | "done" | "error";

const steps = ["Loading the analysis engine", "Detecting landmarks & regions", "Measuring skin and hair", "Matching Bonji products"];

function Index() {
  const [image, setImage] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const catalogRef = useRef<Promise<BonjiProduct[]> | null>(null);

  // Load the live Bonji product feed once on page load and keep it in memory.
  const loadCatalog = useCallback(() => {
    catalogRef.current ??= getBonjiCatalog();
    return catalogRef.current;
  }, []);

  useEffect(() => {
    loadCatalog().catch(() => {
      catalogRef.current = null;
    });
  }, [loadCatalog]);

  const selectImage = useCallback((src: string) => {
    setImage(src);
    setResult(null);
    setError(null);
    setStage("ready");
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!image) return;
    setStage("analyzing");
    setStep(0);
    setError(null);
    try {
      setStep(1);
      const scan = await scanImageDataUrl(image);
      if (!scan.ok) {
        throw new Error(
          scan.reason === "no-face-detected"
            ? "We couldn't detect a face in that photo. Try a well-lit, front-facing selfie."
            : `Scan failed: ${scan.reason ?? "unknown reason"}`,
        );
      }
      setStep(2);

      let products: Awaited<ReturnType<typeof fetchRecommendations>> = [];
      let productsError: string | null = null;
      setStep(3);
      try {
        const [recommended, catalog] = await Promise.all([fetchRecommendations(scan.concerns), loadCatalog()]);
        products = resolveProducts(recommended, catalog);
        if (!products.length) {
          productsError = recommended.length
            ? "We couldn't match the recommended items to the Bonji product catalogue."
            : "No product recommendations were returned for this analysis.";
        }
      } catch (err) {
        productsError =
          err instanceof Error
            ? `Couldn't load product recommendations. ${err.message}`
            : "Couldn't load product recommendations.";
      }

      setResult(buildAnalysis(scan, products, productsError));
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
      setStage("error");
    }
  }, [image, loadCatalog]);




  useEffect(() => {
    if (stage === "done") {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [stage]);


  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  const openCamera = useCallback(async () => {
    setCameraError(null);
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError("We couldn't access your camera. Please allow permission or upload an image instead.");
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 960;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();
    selectImage(canvas.toDataURL("image/jpeg", 0.92));
  }, [selectImage, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => selectImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  const reset = () => {
    setImage(null);
    setResult(null);
    setError(null);
    setStage("idle");
  };


  return (
    <div className="relative min-h-screen overflow-hidden bg-hero-gradient">
      <img
        src={botanical}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="pointer-events-none absolute -left-24 top-10 w-[420px] opacity-40 animate-float-slow"
      />
      <img
        src={botanical}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="pointer-events-none absolute -right-32 top-[45%] w-[520px] rotate-180 opacity-25 animate-float-slow"
      />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <img src={logo} alt="Bonji" width={107} height={36} className="h-9 w-auto" />
        <span className="rounded-full border border-border bg-ivory/70 px-4 py-1.5 text-xs tracking-wide text-muted-foreground backdrop-blur">
          AI Skin Lab
        </span>
      </header>

      <main className="relative mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <section className="mx-auto max-w-3xl pt-10 text-center sm:pt-16">
          <p className="animate-rise-in text-xs uppercase tracking-[0.32em] text-muted-foreground">
            Powered by Bonji Intelligence
          </p>
          <h1 className="animate-rise-in mt-5 text-5xl leading-[1.05] sm:text-6xl md:text-7xl">AI Skin Analysis</h1>
          <p className="animate-rise-in mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Upload a selfie or use your camera and let our AI read your skin in seconds — a gentle, personalised
            assessment with rituals chosen just for you.
          </p>

          <div className="animate-rise-in mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-full bg-primary-gradient px-8 py-4 text-sm font-semibold text-primary-foreground shadow-glow transition-smooth hover:-translate-y-0.5 hover:brightness-105 active:scale-[0.98] sm:w-auto"
            >
              Upload Image
            </button>
            <button
              onClick={openCamera}
              className="w-full rounded-full border border-border bg-ivory px-8 py-4 text-sm font-semibold text-foreground shadow-soft transition-smooth hover:-translate-y-0.5 hover:bg-primary-soft sm:w-auto"
            >
              Use Camera
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
          </div>

          <p className="mt-5 text-xs text-muted-foreground">Your photo is sent securely for analysis only.</p>
        </section>

        {image ? (
          <section ref={resultRef} className="mt-16 scroll-mt-8">
            <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-[minmax(0,320px)_1fr] md:items-center">
              <div className="animate-rise-in relative overflow-hidden rounded-4xl border border-border/70 bg-card p-3 shadow-lift">
                <div className="relative overflow-hidden rounded-3xl">
                  <img src={image} alt="Your uploaded selfie" className="aspect-[3/4] w-full object-cover" />
                  {stage === "analyzing" ? (
                    <>
                      <span className="absolute inset-x-0 h-24 bg-primary-gradient opacity-40 blur-md animate-scan" />
                      <span className="absolute inset-0 bg-ivory/10" />
                    </>
                  ) : null}
                </div>
              </div>

              <div className="animate-rise-in space-y-4">
                {stage === "analyzing" ? (
                  <>
                    <h2 className="text-2xl">Analysing your skin…</h2>
                    <ul className="space-y-3">
                      {steps.map((label, i) => (
                        <li key={label} className="flex items-center gap-3 text-sm">
                          <span
                            className={`grid h-6 w-6 place-items-center rounded-full border text-[11px] transition-smooth ${
                              i <= step
                                ? "border-transparent bg-primary text-primary-foreground"
                                : "border-border bg-ivory text-muted-foreground"
                            }`}
                          >
                            {i < step ? "✓" : i + 1}
                          </span>
                          <span className={i <= step ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary-gradient transition-smooth"
                        style={{ width: `${((step + 1) / steps.length) * 100}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-2xl">{stage === "done" ? "Your photo" : "Ready to analyse"}</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Good lighting and a clear, makeup-free face give the most accurate reading.
                    </p>
                    {error ? (
                      <p className="rounded-2xl border border-border bg-ivory/70 p-4 text-sm text-foreground">
                        {error}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      {stage !== "done" ? (
                        <button
                          onClick={runAnalysis}
                          className="rounded-full bg-primary-gradient px-7 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-smooth hover:-translate-y-0.5 hover:brightness-105"
                        >
                          {stage === "error" ? "Retry analysis" : "Analyze"}
                        </button>
                      ) : null}
                      <button
                        onClick={reset}
                        className="rounded-full border border-border bg-ivory px-6 py-3 text-sm font-semibold shadow-soft transition-smooth hover:bg-primary-soft"
                      >
                        Try another photo
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {stage === "done" && result ? (
              <div className="mt-16">
                <Analysis result={result} />
              </div>
            ) : null}
          </section>
        ) : null}
      </main>


      {cameraOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-4xl border border-border/70 bg-card p-5 shadow-lift">
            <h2 className="mb-4 text-center text-xl">Center your face</h2>
            <div className="overflow-hidden rounded-3xl bg-muted">
              {cameraError ? (
                <p className="p-8 text-center text-sm text-muted-foreground">{cameraError}</p>
              ) : (
                <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full object-cover" />
              )}
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={stopCamera}
                className="flex-1 rounded-full border border-border bg-ivory px-5 py-3 text-sm font-semibold transition-smooth hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={capture}
                disabled={!!cameraError}
                className="flex-1 rounded-full bg-primary-gradient px-5 py-3 text-sm font-semibold text-primary-foreground shadow-glow transition-smooth hover:brightness-105 disabled:opacity-50"
              >
                Capture
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="relative border-t border-border/60 bg-ivory/60 py-8 text-center text-xs text-muted-foreground">
        Bonji AI Skin Analysis · Guidance only, not medical advice.
      </footer>
    </div>
  );
}
