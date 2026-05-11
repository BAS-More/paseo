/**
 * WebSocket backpressure guard.
 *
 * Calling ws.send() unconditionally on a slow client causes the Node.js
 * write buffer to grow without bound until the process runs out of memory.
 * Before sending, callers should check shouldSendMessage() and drop the
 * message if the client's buffer is already too full.
 */

/** 1 MB — default backpressure threshold. */
export const WS_BACKPRESSURE_THRESHOLD = 1_048_576;

/**
 * Returns true if it is safe to send a new message to a WebSocket client.
 *
 * @param bufferedAmount - The number of bytes queued but not yet transmitted
 *   (ws.bufferedAmount for browser WebSocket; manually tracked for the `ws`
 *   npm package which exposes it via ws.bufferedAmount).
 * @param threshold - Drop messages once bufferedAmount reaches this value.
 *   Defaults to 1 MB.
 */
export function shouldSendMessage(
  bufferedAmount: number,
  threshold: number = WS_BACKPRESSURE_THRESHOLD,
): boolean {
  return bufferedAmount < threshold;
}
