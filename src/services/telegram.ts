/**
 * Authenticated client for the server-managed Telegram notification service.
 * Bot credentials and chat identifiers never enter the browser bundle.
 */
import { auth } from "../firebase";

export interface TelegramStatus {
  configured: boolean;
  serverManaged: true;
}

async function authenticatedRequest(path: string, init: RequestInit = {}): Promise<Response | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const idToken = await user.getIdToken();
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(init.headers || {}),
    },
  });
}

export async function getTelegramStatus(): Promise<TelegramStatus> {
  try {
    const response = await authenticatedRequest("/api/telegram/status");
    if (!response?.ok) return { configured: false, serverManaged: true };
    return response.json() as Promise<TelegramStatus>;
  } catch {
    return { configured: false, serverManaged: true };
  }
}
