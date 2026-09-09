//! A tiny, dependency-free token-bucket rate limiter.
//!
//! Bounds the QPS the `/rpc` JSON-RPC gateway forwards to the upstream Solana
//! RPC so the unauthenticated same-origin gateway cannot amplify against a
//! paid/rate-limited provider.

use std::sync::Mutex;
use std::time::Instant;

/// A refilling token bucket. `capacity` tokens are available at rest and refill
/// at `refill_per_sec`; each [`RateLimiter::try_acquire`] consumes one token.
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

    /// Try to consume one token. Returns `true` if the request is allowed.
    pub fn try_acquire(&self) -> bool {
        self.try_acquire_at(Instant::now())
    }

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
        assert!(rl.try_acquire_at(t0));
        assert!(rl.try_acquire_at(t0));
        assert!(rl.try_acquire_at(t0));
        assert!(!rl.try_acquire_at(t0));
    }

    #[test]
    fn refills_over_time() {
        let rl = RateLimiter::new(2.0, 2.0);
        let t0 = Instant::now();
        assert!(rl.try_acquire_at(t0));
        assert!(rl.try_acquire_at(t0));
        assert!(!rl.try_acquire_at(t0));
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
        let t1 = t0 + Duration::from_secs(10);
        assert!(rl.try_acquire_at(t1));
        assert!(rl.try_acquire_at(t1));
        assert!(!rl.try_acquire_at(t1));
    }
}
