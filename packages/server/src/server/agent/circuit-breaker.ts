/**
 * Circuit breaker for AI provider API calls.
 *
 * Prevents thundering-herd when a provider returns 429/503 by stopping
 * further requests while the circuit is "open", then allowing a probe
 * request in "half-open" before fully re-closing.
 *
 * State machine:
 *
 *   closed ──(N consecutive failures)──► open
 *   open   ──(resetTimeoutMs elapsed)──► half-open
 *   half-open ──(recordSuccess)────────► closed
 *   half-open ──(recordFailure)────────► open  (resets timer)
 */

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens. Default: 5. */
  failureThreshold: number;
  /** Milliseconds to remain open before transitioning to half-open. Default: 30000. */
  resetTimeoutMs: number;
  /** How many probe attempts are allowed in half-open before blocking again. Default: 1. */
  halfOpenMaxAttempts: number;
}

export type CircuitState = "closed" | "open" | "half-open";

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 1,
};

export class CircuitBreaker {
  private readonly options: CircuitBreakerOptions;
  private _state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenAttempts = 0;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  get state(): CircuitState {
    // Lazily transition open → half-open once the reset timeout elapses.
    if (this._state === "open" && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.options.resetTimeoutMs) {
        this._state = "half-open";
        this.halfOpenAttempts = 0;
      }
    }
    return this._state;
  }

  /**
   * Returns true if a request may be sent to the provider.
   *
   * - `closed`:    always true.
   * - `open`:      always false.
   * - `half-open`: true for the first `halfOpenMaxAttempts` calls,
   *                false thereafter until the outcome is recorded.
   */
  canExecute(): boolean {
    const s = this.state; // triggers the lazy open→half-open transition
    if (s === "closed") return true;
    if (s === "open") return false;
    // half-open
    if (this.halfOpenAttempts < this.options.halfOpenMaxAttempts) {
      this.halfOpenAttempts++;
      return true;
    }
    return false;
  }

  /** Call when the provider call succeeded. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this._state = "closed";
    this.openedAt = null;
    this.halfOpenAttempts = 0;
  }

  /** Call when the provider call failed (e.g. 429, 503, network error). */
  recordFailure(): void {
    this.consecutiveFailures++;
    if (this._state === "half-open" || this.consecutiveFailures >= this.options.failureThreshold) {
      this._state = "open";
      this.openedAt = Date.now();
      this.halfOpenAttempts = 0;
    }
  }

  /** Hard-reset back to closed with zero failure count. */
  reset(): void {
    this._state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.halfOpenAttempts = 0;
  }
}
