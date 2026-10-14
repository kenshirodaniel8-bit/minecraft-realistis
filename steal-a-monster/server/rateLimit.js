// Token-bucket rate limiter per player and message type.

export class RateLimiter {
  constructor(limits, now) {
    this.limits = limits;
    this.now = now;
    this.buckets = new Map();
    this.dropped = 0;
  }

  allow(type) {
    const rate = this.limits[type] ?? this.limits.default;
    const burst = rate * 2;
    const t = this.now();
    let b = this.buckets.get(type);
    if (!b) {
      b = { tokens: burst, at: t };
      this.buckets.set(type, b);
    }
    b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * rate);
    b.at = t;
    if (b.tokens < 1) {
      this.dropped++;
      return false;
    }
    b.tokens -= 1;
    return true;
  }
}
