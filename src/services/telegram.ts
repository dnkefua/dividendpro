/**
 * Telegram Notification Service
 * ─────────────────────────────
 * Sends messages to a Telegram chat via Bot API.
 * Setup: Create a bot via @BotFather → get token.
 *        Message the bot once → get your chat ID from
 *        https://api.telegram.org/bot{TOKEN}/getUpdates
 */

const TELEGRAM_API = "https://api.telegram.org/bot";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function getConfig(): TelegramConfig | null {
  // Priority: env vars → localStorage settings → hardcoded active bot defaults
  const botToken =
    (import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string) ||
    localStorage.getItem("divpro_tg_token") ||
    "8911591416:AAF9wdmJ9ppjLZZEe-4xY_cxdqURj-r6t_o";
  const chatId =
    (import.meta.env.VITE_TELEGRAM_CHAT_ID as string) ||
    localStorage.getItem("divpro_tg_chat_id") ||
    "6044637051";
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

export function saveTelegramConfig(botToken: string, chatId: string): void {
  localStorage.setItem("divpro_tg_token", botToken);
  localStorage.setItem("divpro_tg_chat_id", chatId);
}

export function getStoredChatId(): string {
  return (import.meta.env.VITE_TELEGRAM_CHAT_ID as string) ||
    localStorage.getItem("divpro_tg_chat_id") || "6044637051";
}

export function getStoredToken(): string {
  return (import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string) ||
    localStorage.getItem("divpro_tg_token") || "8911591416:AAF9wdmJ9ppjLZZEe-4xY_cxdqURj-r6t_o";
}

export function hasTelegramConfig(): boolean {
  return !!getConfig();
}

/** Poll getUpdates to auto-discover the user's chat ID.
 *  Returns chat ID string if found, null if no messages yet. */
export async function discoverChatId(): Promise<string | null> {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const res = await fetch(
      `${TELEGRAM_API}${token}/getUpdates?limit=10&allowed_updates=["message"]`
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      ok: boolean;
      result: Array<{ message?: { chat: { id: number; first_name?: string } } }>;
    };
    if (!data.ok || !data.result.length) return null;
    // Use the most recent message sender
    for (let i = data.result.length - 1; i >= 0; i--) {
      const msg = data.result[i].message;
      if (msg?.chat?.id) {
        const chatId = String(msg.chat.id);
        localStorage.setItem("divpro_tg_chat_id", chatId);
        return chatId;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Get bot display name from Telegram */
export async function getBotInfo(): Promise<{ username: string; name: string } | null> {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const res = await fetch(`${TELEGRAM_API}${token}/getMe`);
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; result: { username: string; first_name: string } };
    if (!data.ok) return null;
    return { username: data.result.username, name: data.result.first_name };
  } catch {
    return null;
  }
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const config = getConfig();
  if (!config) return false;
  try {
    const res = await fetch(
      `${TELEGRAM_API}${config.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── Pre-built notification templates ──────────────────────────────────────────

export async function notifySnipeBuy(
  symbol: string,
  contract: string,
  amountTokens: number,
  spentBnb: number,
  txHash: string
): Promise<void> {
  const msg =
    `🚀 <b>SNIPED — ${symbol}</b>\n\n` +
    `📦 Tokens: <code>${amountTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })}</code>\n` +
    `💰 Spent: <code>${spentBnb.toFixed(4)} BNB</code>\n` +
    `🔗 Contract: <code>${contract}</code>\n` +
    `📋 <a href="https://bscscan.com/tx/${txHash}">View TX on BscScan</a>`;
  await sendTelegramMessage(msg);
}

export async function notifySnipeSell(
  symbol: string,
  contract: string,
  pnlPct: number,
  pnlBnb: number,
  bnbReceived: number,
  reason: string,
  txHash: string
): Promise<void> {
  const isProfit = pnlBnb >= 0;
  const emoji = isProfit ? "🟢" : "🔴";
  const sign = isProfit ? "+" : "";
  const msg =
    `${emoji} <b>${isProfit ? "PROFIT" : "LOSS"} — ${symbol}</b>\n\n` +
    `📊 PnL: <b>${sign}${pnlPct.toFixed(2)}%</b>  (${sign}${pnlBnb.toFixed(4)} BNB)\n` +
    `💰 Received: <code>${bnbReceived.toFixed(4)} BNB</code>\n` +
    `📌 Reason: ${reason}\n` +
    `🔗 Contract: <code>${contract}</code>\n` +
    `📋 <a href="https://bscscan.com/tx/${txHash}">View TX on BscScan</a>`;
  await sendTelegramMessage(msg);
}

export async function notifyHoneypot(symbol: string, contract: string): Promise<void> {
  const msg =
    `⚠️ <b>HONEYPOT BLOCKED — ${symbol}</b>\n\n` +
    `🛡️ Safety check prevented a dangerous buy.\n` +
    `🔗 Contract: <code>${contract}</code>`;
  await sendTelegramMessage(msg);
}

export async function notifyBotStarted(walletAddress: string): Promise<void> {
  const msg =
    `🟢 <b>DividendPro Sniper Bot STARTED</b>\n\n` +
    `👛 Wallet: <code>${walletAddress}</code>\n` +
    `⏰ ${new Date().toLocaleString()}`;
  await sendTelegramMessage(msg);
}

export async function notifyHummingbotProfit(
  pair: string,
  strategy: string,
  profitUsd: number,
  profitBnb: number,
  exchange: string
): Promise<void> {
  const msg =
    `💰 <b>LUMINA HUMMINGBOT PROFIT ALERT!</b>\n\n` +
    `🤖 Strategy: <b>${strategy}</b>\n` +
    `🔀 Pair: <b>${pair}</b>\n` +
    `🏦 Exchange: <code>${exchange}</code>\n` +
    `📈 Net Profit: <b>+$${profitUsd.toFixed(2)} USD</b> (+${profitBnb.toFixed(4)} BNB)\n` +
    `⏰ Time: ${new Date().toLocaleTimeString()}\n\n` +
    `🚀 Lumina Autonomous Yield Engine Active!`;
  await sendTelegramMessage(msg);
}

export async function notifyBotStopped(): Promise<void> {
  const msg =
    `🔴 <b>DividendPro Sniper Bot STOPPED</b>\n` +
    `⏰ ${new Date().toLocaleString()}`;
  await sendTelegramMessage(msg);
}

export async function testTelegramConnection(): Promise<boolean> {
  return sendTelegramMessage(
    "✅ <b>DividendPro Sniper</b> — Telegram notifications connected!"
  );
}
