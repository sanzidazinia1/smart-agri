// Small browser helpers to call the app's API routes (POST, PATCH, DELETE, PUT)

// Sends a JSON request and throws the server's error message if it fails
async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || "Request failed");
  }
  return data as T;
}

// Shortcuts for each HTTP method
export const apiPost = <T = unknown>(url: string, body?: unknown) =>
  send<T>(url, "POST", body);
export const apiPatch = <T = unknown>(url: string, body?: unknown) =>
  send<T>(url, "PATCH", body);
export const apiDelete = <T = unknown>(url: string) => send<T>(url, "DELETE");
export const apiPut = <T = unknown>(url: string, body?: unknown) =>
  send<T>(url, "PUT", body);
