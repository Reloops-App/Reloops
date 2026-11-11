export async function fetchTextResource(url: string, init?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(url, { method: "GET", mode: "cors", credentials: "omit", signal: init?.signal });
  if (!res.ok) throw new Error(`Failed to fetch resource (${res.status})`);
  return res.text();
}
