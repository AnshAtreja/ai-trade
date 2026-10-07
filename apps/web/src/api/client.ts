const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:4000";

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as { message?: unknown; error?: { message?: unknown } };
  if (typeof record.message === "string" && record.message) return record.message;
  if (typeof record.error?.message === "string" && record.error.message) return record.error.message;
  return fallback;
}

export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ message: `API request failed for ${path}` }));
    throw new Error(errorMessage(errorPayload, `API request failed for ${path}`));
  }

  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ message: `API request failed for ${path}` }));
    throw new Error(errorMessage(errorPayload, `API request failed for ${path}`));
  }

  return response.json() as Promise<T>;
}
