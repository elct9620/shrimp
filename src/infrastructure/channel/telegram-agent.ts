import https from "node:https";

/**
 * HTTP agent used for Telegram Bot API calls.
 *
 * Keep-alive is disabled so each request gets a fresh TCP+TLS handshake.
 *
 * Why: cloud NAT / container conntrack tables silently drop idle outbound
 * TCP connections (commonly after 5–10 minutes of inactivity) without
 * sending RST. A pooled keep-alive socket then looks live to the client
 * but is dead in the wire, and the next reuse blocks until ETIMEDOUT —
 * taking the message with it. Application-level retry only helps until the
 * pool drains; if multiple stale sockets accumulated, every retry hits a
 * corpse before a fresh connection is made. The next user message then
 * succeeds because the pool is empty — the exact self-healing pattern
 * observed in production.
 *
 * Telegram outbound traffic is low frequency (~1–N small POSTs per user
 * message), so the handshake cost is negligible vs. delivery reliability.
 *
 * Implemented on Node's `https.Agent` rather than an undici `Dispatcher`
 * because node-fetch routes through `https.request` and accepts a
 * Node-native agent without dispatch-protocol versioning concerns.
 */
export function createTelegramAgent(): https.Agent {
  return new https.Agent({ keepAlive: false });
}
