//! A tiny, dependency-free token-bucket rate limiter.
//!
//! Used to bound the QPS the `/rpc` gateway forwards to the private (typically
//! paid / rate-limited) upstream Solana RPC, so the unauthenticated same-origin
//! gateway can't be turned into a high-volume amplifier (sendTransaction spam,
//! bulk getProgramAccounts) against the upstream. This is a GLOBAL cap (the
//! indexer usually sees the app-server proxy's single IP, not per-client IPs), a
//! defense-in-depth layer under any per-IP limiting / network isolation applied
//! at the deployment edge.

use std::sync::Mutex;
use std::time::Instant;

/// A refilling token bucket. `capacity` tokens are available at rest and refill
/// at `refill_per_sec`; each [`RateLimiter::try_acquire`] consumes one token and
/// returns whether one was available.
pub struct RateLimiter {
    inner: Mutex<Bucket>,
    capacity: f64,
    refill_per_sec: f64,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    /// A bucket that holds up to `capacity` requests of burst and sustains
    /// `refill_per_sec` requests/second. Both must be positive.
    pub fn new(capacity: f64, refill_per_sec: f64) -> Self {
        Self {
            inner: Mutex::new(Bucket {
                tokens: capacity,
                last: Instant::now(),
            }),
            capacity,
            refill_per_sec,
        }
    }

    /// Try to consume one token. Returns `true` if the request is allowed, `false`
    /// if the bucket is empty (caller should reject, e.g. HTTP 429).
    pub fn try_acquire(&self) -> bool {
        self.try_acquire_at(Instant::now())
    }

    /// [`try_acquire`](Self::try_acquire) against an explicit clock — the testable
    /// core (real callers pass `Instant::now()`).
    fn try_acquire_at(&self, now: Instant) -> bool {
        let mut b = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let elapsed = now.saturating_duration_since(b.last).as_secs_f64();
        b.tokens = (b.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        b.last = now;
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn allows_a_burst_up_to_capacity_then_blocks() {
        let rl = RateLimiter::new(3.0, 1.0);
        let t0 = Instant::now();
        // Full bucket: three requests at the same instant succeed.
        assert!(rl.try_acquire_at(t0));
        assert!(rl.try_acquire_at(t0));
        assert!(rl.try_acquire_at(t0));
        // Bucket empty: the fourth (same instant) is rejected.
        assert!(!rl.try_acquire_at(t0));
    }

    #[test]
    fn refills_over_time() {
        let rl = RateLimiter::new(2.0, 2.0); // 2 tokens, +2/sec
        let t0 = Instant::now();
        assert!(rl.try_acquire_at(t0));
        assert!(rl.try_acquire_at(t0));
        assert!(!rl.try_acquire_at(t0));
        // After 0.5s at 2/sec, exactly one token is back.
        let t1 = t0 + Duration::from_millis(500);
        assert!(rl.try_acquire_at(t1));
        assert!(!rl.try_acquire_at(t1));
    }

    #[test]
    fn refill_is_capped_at_capacity() {
        let rl = RateLimiter::new(2.0, 100.0);
        let t0 = Instant::now();
        assert!(rl.try_acquire_at(t0));
        assert!(rl.try_acquire_at(t0));
        // Wait long enough to refill far past capacity; still only `capacity` burst.
        let t1 = t0 + Duration::from_secs(10);
        assert!(rl.try_acquire_at(t1));
        assert!(rl.try_acquire_at(t1));
        assert!(!rl.try_acquire_at(t1));
    }
}
