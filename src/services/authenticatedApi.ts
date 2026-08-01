import { auth } from "../firebase";

export async function authenticatedApiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in is required for this server-managed API.");
  const idToken = await user.getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${idToken}`,
      ...(init.headers || {}),
    },
  });
}
