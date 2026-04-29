import { Agent, type Dispatcher } from "undici";

/**
 * Build the undici Dispatcher used for Telegram Bot API calls.
 *
 * Keep-alive is effectively disabled by squeezing the idle-socket lifetime
 * to ~1ms. Each request gets a fresh TCP+TLS handshake.
 *
 * Why: cloud NAT / container conntrack tables silently drop idle outbound
 * TCP connections (commonly after 5–10 minutes of inactivity) without
 * sending RST. undici keeps the dead socket in its pool and the next
 * reuse blocks until ETIMEDOUT, taking the message with it. Application-
 * level retry only helps until the pool drains; if multiple stale sockets
 * accumulated, every retry hits another corpse before a fresh connection
 * is made. The next user message then succeeds because the pool is empty —
 * the exact self-healing pattern observed in production.
 *
 * Telegram outbound traffic is low frequency (~1–N small POSTs per user
 * message), so the handshake cost is negligible compared to message
 * delivery reliability.
 */
export function createTelegramDispatcher(): Dispatcher {
  return new Agent({
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
  });
}
