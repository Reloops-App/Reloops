import { useEffect, useRef, useState } from "react";
import { withMediaCorsHint } from "@/lib/mediaDelivery";

export type WaveformPeaks = {
  left: number[];
  right?: number[];
};

const BUCKET_COUNT = 800;

// Decoded peaks are cheap to keep around for the session and expensive to
// recompute (fetch + decodeAudioData over the whole file), so cache by URL.
const peaksCache = new Map<string, WaveformPeaks>();
const inflight = new Map<string, Promise<WaveformPeaks>>();

function downsampleChannel(data: Float32Array, buckets: number): number[] {
  const bucketSize = Math.max(1, Math.floor(data.length / buckets));
  const peaks = new Array<number>(buckets).fill(0);
  for (let b = 0; b < buckets; b++) {
    const start = b * bucketSize;
    const end = b === buckets - 1 ? data.length : start + bucketSize;
    let max = 0;
    for (let i = start; i < end; i++) {
      const abs = Math.abs(data[i]);
      if (abs > max) max = abs;
    }
    peaks[b] = max;
  }
  return peaks;
}

async function decodePeaks(url: string): Promise<WaveformPeaks> {
  const response = await fetch(withMediaCorsHint(url));
  if (!response.ok) throw new Error(`Failed to fetch audio (${response.status})`);
  const arrayBuffer = await response.arrayBuffer();

  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("Web Audio API unsupported");
  const ctx = new AudioContextCtor();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const left = downsampleChannel(audioBuffer.getChannelData(0), BUCKET_COUNT);
    const right = audioBuffer.numberOfChannels > 1
      ? downsampleChannel(audioBuffer.getChannelData(1), BUCKET_COUNT)
      : undefined;
    return { left, right };
  } finally {
    void ctx.close();
  }
}

function getPeaks(url: string): Promise<WaveformPeaks> {
  const cached = peaksCache.get(url);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = decodePeaks(url)
    .then((peaks) => {
      peaksCache.set(url, peaks);
      inflight.delete(url);
      return peaks;
    })
    .catch((err) => {
      inflight.delete(url);
      throw err;
    });
  inflight.set(url, promise);
  return promise;
}

export function useWaveformPeaks(url: string | null | undefined) {
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestedUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!url) {
      setPeaks(null);
      setLoading(false);
      setError(false);
      return;
    }

    requestedUrl.current = url;
    const cached = peaksCache.get(url);
    if (cached) {
      setPeaks(cached);
      setLoading(false);
      setError(false);
      return;
    }

    setPeaks(null);
    setLoading(true);
    setError(false);

    getPeaks(url)
      .then((result) => {
        if (requestedUrl.current !== url) return;
        setPeaks(result);
        setLoading(false);
      })
      .catch(() => {
        if (requestedUrl.current !== url) return;
        setPeaks(null);
        setLoading(false);
        setError(true);
      });
  }, [url]);

  return { peaks, loading, error };
}
