import type { ScanResult, Scanner } from "@/face-scanner/scanner";

let scannerPromise: Promise<Scanner> | null = null;

/** Loads the existing face-scanner engine (browser only, MediaPipe WASM). */
export function getScanner(): Promise<Scanner> {
  if (!scannerPromise) {
    scannerPromise = import("@/face-scanner/scanner.js").then((m) =>
      (m as unknown as { createScanner: (o?: unknown) => Promise<Scanner> }).createScanner({ frames: 3, frameDelayMs: 60 }),
    );
  }
  return scannerPromise;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = dataUrl;
  });
}

/** Runs the existing scanner.js pipeline over a still image. */
export async function scanImageDataUrl(dataUrl: string): Promise<ScanResult> {
  const [scanner, img] = await Promise.all([getScanner(), loadImage(dataUrl)]);
  await img.decode?.().catch(() => undefined);
  return scanner.scanImage(img);
}

export type { ScanResult, ScanConcern, ScanWarning } from "@/face-scanner/scanner";
