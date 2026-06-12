// fetch with retry and timeout. CI runner IPs get rate-limited and
// flagged in ways residential IPs don't, so every upstream call retries
// once after a 2s pause before giving up.

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const retryDelay = Number(process.env.KISMET_RETRY_DELAY_MS ?? 2000);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(retryDelay);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      return (await res.json()) as T;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
