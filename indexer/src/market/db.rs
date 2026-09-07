//! Postgres persistence for the indexed kassandra-market accounts.
//!
//! Replaces the standalone indexer's in-memory `Store`. One table
//! (`market_accounts`) holds the raw Pod bytes of every Config / Market /
//! Contribution account, keyed by pubkey and slot-gated so an out-of-order
//! (older) datasource event can never clobber a newer one. Reads decode the
//! bytes back into `kassandra_markets_program::state` structs on demand.

use std::collections::HashSet;
use std::str::FromStr;

use anyhow::{Context, Result};
use kassandra_markets_program::state::{Config, Contribution, Market};
use solana_pubkey::Pubkey;
use tokio_postgres::Client;

/// `account_type` tag values (mirror `state::AccountType`).
pub const TYPE_CONFIG: i16 = 1;
pub const TYPE_MARKET: i16 = 2;
pub const TYPE_CONTRIBUTION: i16 = 3;
pub const TYPE_ER_SESSION: i16 = 4;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS market_accounts (
  pubkey       TEXT     PRIMARY KEY,
  account_type SMALLINT NOT NULL,   -- 1=Config 2=Market 3=Contribution 4=ErSession
  market_ref   TEXT,                -- Contribution.market (base58) for indexed lookup
  slot         BIGINT   NOT NULL,
  data         BYTEA    NOT NULL    -- raw Pod bytes; decoded on read
);
CREATE INDEX IF NOT EXISTS market_accounts_type_idx ON market_accounts (account_type);
CREATE INDEX IF NOT EXISTS market_accounts_market_ref_idx ON market_accounts (market_ref);

-- Price time-series for each Active market's cYES/cNO pool, recorded by the
-- websocket price subscriber (`price_subscribe`): one row per (market, slot),
-- upserted to the LATEST observed reserves for that slot. A single slot can
-- carry more than one real swap on a busy chain (or under a slow local
-- `clock`-mode block-production interval), so "one row per slot" can't mean
-- "first write wins" — that silently dropped later, truly-final trades in
-- that slot (confirmed empirically: two distinct swaps landed in one slot,
-- and the second's real effect on the price never made it into any candle).
-- The upsert makes "last write wins" instead, so the persisted row always
-- reflects the most-recently-observed reserves for that slot, same as a
-- read of the live account would. `price` is the implied YES probability
-- P(YES) = quote / (base + quote), 0..1. Candles are aggregated from this on
-- read (see `get_candles`).
CREATE TABLE IF NOT EXISTS market_price (
  market TEXT   NOT NULL,          -- Market pubkey (base58)
  slot   BIGINT NOT NULL,          -- slot the sample was read at
  ts     BIGINT NOT NULL,          -- unix seconds at capture (server clock)
  base   BIGINT NOT NULL,          -- cYES reserve (raw base units)
  quote  BIGINT NOT NULL,          -- cNO reserve (raw base units)
  price  DOUBLE PRECISION NOT NULL,-- implied P(YES) = quote / (base + quote)
  PRIMARY KEY (market, slot)
);
CREATE INDEX IF NOT EXISTS market_price_market_ts_idx ON market_price (market, ts);
"#;

/// One OHLC candle aggregated from `market_price` samples in a time bucket.
pub struct Candle {
    /// Bucket start, unix seconds (aligned to the bucket width).
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
}

/// Create the market schema (idempotent; runs alongside the oracle schema on the
/// same Postgres connection).
pub async fn create_schema(client: &Client) -> Result<()> {
    client.batch_execute(SCHEMA).await?;
    Ok(())
}

/// Slot-gated upsert of one decoded account's raw bytes. The `WHERE` gate means an
/// update only applies if its slot is `>=` the stored slot (last-writer-wins on an
/// equal slot), mirroring the old in-memory store's gate.
pub async fn upsert_account(
    client: &Client,
    pubkey: &str,
    account_type: i16,
    market_ref: Option<&str>,
    slot: i64,
    data: &[u8],
) -> Result<()> {
    client
        .execute(
            "INSERT INTO market_accounts (pubkey, account_type, market_ref, slot, data)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (pubkey) DO UPDATE
               SET account_type = EXCLUDED.account_type,
                   market_ref   = EXCLUDED.market_ref,
                   slot         = EXCLUDED.slot,
                   data         = EXCLUDED.data
               WHERE market_accounts.slot <= EXCLUDED.slot",
            &[&pubkey, &account_type, &market_ref, &slot, &data],
        )
        .await?;
    Ok(())
}

/// Prune accounts CLOSED on-chain — i.e. absent from an authoritative
/// getProgramAccounts snapshot taken at `snapshot_slot`, whose stored slot is
/// `<= snapshot_slot` (a row newer than the snapshot is kept: the snapshot simply
/// predates it, it isn't closed). Pass the base58 pubkeys present in the snapshot.
/// Only call after a snapshot that fetched successfully.
pub async fn prune(client: &Client, snapshot_slot: i64, present: &HashSet<String>) -> Result<u64> {
    let present_vec: Vec<String> = present.iter().cloned().collect();
    let n = client
        .execute(
            "DELETE FROM market_accounts
             WHERE slot <= $1 AND NOT (pubkey = ANY($2))",
            &[&snapshot_slot, &present_vec],
        )
        .await
        .context("prune market_accounts")?;
    Ok(n)
}

fn decode<T: bytemuck::AnyBitPattern>(data: &[u8], len: usize) -> Option<T> {
    (data.len() >= len).then(|| bytemuck::pod_read_unaligned::<T>(&data[..len]))
}

/// The governed singleton `Config` (pubkey, value, slot), if indexed.
pub async fn get_config(client: &Client) -> Result<Option<(Pubkey, Config, u64)>> {
    let rows = client
        .query(
            "SELECT pubkey, slot, data FROM market_accounts
             WHERE account_type = $1 ORDER BY slot DESC LIMIT 1",
            &[&TYPE_CONFIG],
        )
        .await?;
    Ok(rows.first().and_then(|r| {
        let pk: String = r.get(0);
        let slot: i64 = r.get(1);
        let data: Vec<u8> = r.get(2);
        let pubkey = Pubkey::from_str(&pk).ok()?;
        let cfg = decode::<Config>(&data, Config::LEN)?;
        Some((pubkey, cfg, slot as u64))
    }))
}

/// All indexed markets (pubkey, value, slot).
pub async fn get_markets(client: &Client) -> Result<Vec<(Pubkey, Market, u64)>> {
    let rows = client
        .query(
            "SELECT pubkey, slot, data FROM market_accounts WHERE account_type = $1",
            &[&TYPE_MARKET],
        )
        .await?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            let pk: String = r.get(0);
            let slot: i64 = r.get(1);
            let data: Vec<u8> = r.get(2);
            let pubkey = Pubkey::from_str(&pk).ok()?;
            let m = decode::<Market>(&data, Market::LEN)?;
            Some((pubkey, m, slot as u64))
        })
        .collect())
}

/// The `(market_pubkey_base58, amm)` of every ACTIVE market with a composed pool.
/// The price subscriber uses this to (un)subscribe to each live cYES/cNO pool:
/// status 1 = Active, and a zeroed `amm` means the pool isn't composed yet.
pub async fn active_market_amms(client: &Client) -> Result<Vec<(String, Pubkey)>> {
    Ok(get_markets(client)
        .await?
        .into_iter()
        .filter_map(|(pk, m, _slot)| {
            let amm = Pubkey::new_from_array(m.amm.to_bytes());
            (m.status == 1 && amm != Pubkey::default()).then(|| (pk.to_string(), amm))
        })
        .collect())
}

/// One market by pubkey (value, slot).
pub async fn get_market(client: &Client, pubkey: &str) -> Result<Option<(Market, u64)>> {
    let rows = client
        .query(
            "SELECT slot, data FROM market_accounts WHERE pubkey = $1 AND account_type = $2",
            &[&pubkey, &TYPE_MARKET],
        )
        .await?;
    Ok(rows.first().and_then(|r| {
        let slot: i64 = r.get(0);
        let data: Vec<u8> = r.get(1);
        let m = decode::<Market>(&data, Market::LEN)?;
        Some((m, slot as u64))
    }))
}

/// Append one price sample for `market` at `slot`, upserting `base`/`quote`/
/// `price` to the LATEST observed reserves when another sample already
/// exists for that exact (market, slot) pair. Two different swaps against
/// the same market CAN land in the same slot (common on a busy chain; also
/// reproducible locally with a slow `clock`-mode block-production interval)
/// — with a plain "ignore on conflict" insert, the second (truly final)
/// swap's price would be silently and permanently lost, leaving the
/// recorded series — and every candle built from it — stuck on the FIRST
/// swap's now-stale state. The upsert means the row for a given slot always
/// reflects whichever call's reserves landed last, matching what a live
/// read of the account would show. A genuinely repeated, unchanged-pool
/// notification (the original reason this table keys on slot at all) just
/// upserts the same values back — a harmless no-op write, not a correctness
/// concern.
///
/// `ts` is deliberately NOT part of the update: `slot` is the true,
/// stable event-ordering key, while `ts` is just this process's wall-clock
/// capture time — a redundant re-observation of the SAME slot (e.g. the ws
/// subscriber's unconditional baseline re-seed on every reconnect, or a
/// benign race against the live-read path's own recording) can land
/// meaningfully LATER in wall-clock terms with no actual reserve change. If
/// `ts` moved on every such re-observation, a sample could silently migrate
/// into a different candle bucket (`get_candles` buckets by `ts`) purely
/// from reconnect/race timing, not from any real trading activity — keeping
/// the first-observed `ts` avoids that instability while `base`/`quote`/
/// `price` still always reflect the true latest on-chain state.
pub async fn insert_price(
    client: &Client,
    market: &str,
    slot: i64,
    ts: i64,
    base: i64,
    quote: i64,
    price: f64,
) -> Result<()> {
    client
        .execute(
            "INSERT INTO market_price (market, slot, ts, base, quote, price)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (market, slot) DO UPDATE
               SET base = EXCLUDED.base,
                   quote = EXCLUDED.quote,
                   price = EXCLUDED.price",
            &[&market, &slot, &ts, &base, &quote, &price],
        )
        .await?;
    Ok(())
}

/// The most recent sample's `(base, quote)` reserves for `market`, if any. Used to
/// skip re-recording an unchanged pool from a live read (mirrors the ws path's
/// record-on-change-only semantics), keeping the series a clean change-log.
pub async fn latest_price_reserves(client: &Client, market: &str) -> Result<Option<(i64, i64)>> {
    let rows = client
        .query(
            "SELECT base, quote FROM market_price WHERE market = $1 ORDER BY slot DESC LIMIT 1",
            &[&market],
        )
        .await?;
    Ok(rows.first().map(|r| (r.get(0), r.get(1))))
}

/// OHLC candles for `market`, bucketed by `bucket_secs`, most-recent `limit`
/// buckets returned in ascending time order. `open`/`close` are the first/last
/// sample (by slot) in each bucket; `high`/`low` the extremes.
pub async fn get_candles(
    client: &Client,
    market: &str,
    bucket_secs: i64,
    limit: i64,
) -> Result<Vec<Candle>> {
    let rows = client
        .query(
            "SELECT bucket_ts, open, high, low, close FROM (
               SELECT (ts / $2) * $2 AS bucket_ts,
                      (array_agg(price ORDER BY slot ASC))[1]  AS open,
                      MAX(price)                               AS high,
                      MIN(price)                               AS low,
                      (array_agg(price ORDER BY slot DESC))[1] AS close
               FROM market_price
               WHERE market = $1
               GROUP BY bucket_ts
               ORDER BY bucket_ts DESC
               LIMIT $3
             ) b
             ORDER BY bucket_ts ASC",
            &[&market, &bucket_secs, &limit],
        )
        .await?;
    Ok(rows
        .iter()
        .map(|r| Candle {
            time: r.get(0),
            open: r.get(1),
            high: r.get(2),
            low: r.get(3),
            close: r.get(4),
        })
        .collect())
}

/// All contributions whose `market` field points at `market` (base58).
pub async fn contributions_for(client: &Client, market: &str) -> Result<Vec<(Contribution, i64)>> {
    // Each row carries its last-write `slot` (last-writer-wins): the Contribution
    // PDA is (re)written on the funding create AND on every post-activation
    // `add_liquidity`, so its slot is the contributor's most-recent activity. Order
    // by it descending so the ledger reads latest-first without a client-side sort.
    let rows = client
        .query(
            "SELECT data, slot FROM market_accounts \
             WHERE account_type = $1 AND market_ref = $2 ORDER BY slot DESC",
            &[&TYPE_CONTRIBUTION, &market],
        )
        .await?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            let data: Vec<u8> = r.get(0);
            let slot: i64 = r.get(1);
            decode::<Contribution>(&data, Contribution::LEN).map(|c| (c, slot))
        })
        .collect())
}

#[cfg(test)]
mod db_it {
    //! Postgres integration test for the price series → candle aggregation. The
    //! OHLC SQL (integer-bucketed `GROUP BY`, `array_agg … ORDER BY`,
    //! `ON CONFLICT ... DO UPDATE`) is Postgres-specific, so it runs on the real
    //! engine. Self-skips (never fails) when `TEST_DATABASE_URL` is unset — the
    //! dedicated CI `db-it` job provides a Postgres service and sets it.

    use super::*;
    use std::sync::Arc;

    async fn test_client() -> Option<Arc<Client>> {
        let url = std::env::var("TEST_DATABASE_URL").ok()?;
        let client = match crate::db::connect(&url).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[db_it] connect to TEST_DATABASE_URL failed ({e}); skipping");
                return None;
            }
        };
        create_schema(&client).await.ok()?;
        Some(client)
    }

    #[tokio::test]
    async fn candles_aggregate_ohlc_from_price_samples() {
        let Some(client) = test_client().await else {
            eprintln!("[db_it] TEST_DATABASE_URL unset — skipping Postgres integration test");
            return;
        };
        client
            .batch_execute("TRUNCATE market_price")
            .await
            .expect("truncate");

        // Bucket 0 (width 60s): three samples at ts 0/30/30, slots 1/2/3.
        insert_price(&client, "MktA", 1, 0, 100, 100, 0.50)
            .await
            .unwrap();
        insert_price(&client, "MktA", 2, 30, 100, 300, 0.75)
            .await
            .unwrap();
        insert_price(&client, "MktA", 3, 30, 100, 9900, 0.99)
            .await
            .unwrap();
        // Same (market, slot) as the 0.75 point, but DIFFERENT reserves — a
        // second real swap landing in the same slot as an earlier one (see
        // `insert_price`'s doc comment: this is exactly the scenario that
        // used to silently lose data under `ON CONFLICT DO NOTHING`). The
        // upsert must overwrite slot 2's row to this LATEST value, not
        // ignore it.
        insert_price(&client, "MktA", 2, 30, 1, 1, 0.01)
            .await
            .unwrap();
        // Bucket 60: a single sample at ts 90, slot 4.
        insert_price(&client, "MktA", 4, 90, 100, 100, 0.50)
            .await
            .unwrap();
        // A different market must not bleed into MktA's candles.
        insert_price(&client, "MktB", 9, 0, 1, 1, 0.10)
            .await
            .unwrap();

        let candles = get_candles(&client, "MktA", 60, 100).await.unwrap();
        assert_eq!(candles.len(), 2, "two 60s buckets");

        // Bucket 0: open=first-by-slot(0.50), close=last-by-slot(0.99) — slot 2's
        // row is now 0.01 (overwritten), so it's neither open nor close, but it
        // DOES pull the bucket's low down to 0.01 (MIN(price) over the bucket's
        // current rows, which now includes the overwritten value).
        let b0 = &candles[0];
        assert_eq!(b0.time, 0);
        assert!((b0.open - 0.50).abs() < 1e-9, "open {}", b0.open);
        assert!((b0.close - 0.99).abs() < 1e-9, "close {}", b0.close);
        assert!((b0.high - 0.99).abs() < 1e-9, "high {}", b0.high);
        assert!((b0.low - 0.01).abs() < 1e-9, "low {}", b0.low);

        // Bucket 60: a lone sample → O=H=L=C.
        let b1 = &candles[1];
        assert_eq!(b1.time, 60);
        assert!((b1.close - 0.50).abs() < 1e-9);

        // `limit` keeps the most-recent buckets, still returned ascending.
        let recent = get_candles(&client, "MktA", 60, 1).await.unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].time, 60);
    }

    /// Regression test for a confirmed production bug: two DIFFERENT real
    /// swaps against the same market can land in the same slot (verified
    /// empirically against a real surfpool validator + the real indexer
    /// binary — two distinct, confirmed on-chain trades landed in one slot,
    /// and under the old `ON CONFLICT DO NOTHING` the second swap's true
    /// final reserves were silently and permanently lost; the chart showed
    /// ~10% when the real on-chain probability was ~92%). A second
    /// `insert_price` call for the same (market, slot) must overwrite
    /// `base`/`quote`/`price` to the newest values, not be ignored — but
    /// `ts` deliberately stays at the FIRST observation (see `insert_price`'s
    /// doc comment: `slot`, not `ts`, is the true ordering key, and letting
    /// `ts` drift on a same-slot re-observation risks silent candle-bucket
    /// migration with no real trading activity behind it).
    #[tokio::test]
    async fn insert_price_upserts_to_the_latest_value_on_a_same_slot_collision() {
        let Some(client) = test_client().await else {
            eprintln!("[db_it] TEST_DATABASE_URL unset — skipping Postgres integration test");
            return;
        };
        client
            .batch_execute("TRUNCATE market_price")
            .await
            .expect("truncate");

        // First swap lands in slot 42: reserves imply "mostly NO" (price ~0.10).
        insert_price(&client, "MktE", 42, 100, 3_000_000_000, 335_570_470, 0.1006)
            .await
            .unwrap();
        // A second, genuinely different swap lands in the SAME slot 42
        // (the confirmed real-world scenario): reserves now imply "mostly
        // YES" (price ~0.92) — the true final on-chain state.
        insert_price(&client, "MktE", 42, 101, 304_549_977, 3_335_570_470, 0.9163)
            .await
            .unwrap();

        let rows = client
            .query(
                "SELECT slot, ts, base, quote, price FROM market_price WHERE market = $1",
                &[&"MktE"],
            )
            .await
            .unwrap();
        assert_eq!(
            rows.len(),
            1,
            "still exactly one row for (market, slot) — no duplicate row"
        );
        let slot: i64 = rows[0].get(0);
        let ts: i64 = rows[0].get(1);
        let base: i64 = rows[0].get(2);
        let quote: i64 = rows[0].get(3);
        let price: f64 = rows[0].get(4);
        assert_eq!(slot, 42);
        assert_eq!(
            ts, 100,
            "ts stays at the FIRST observation, not overwritten"
        );
        assert_eq!(
            base, 304_549_977,
            "base overwritten to the later, true final reserves"
        );
        assert_eq!(
            quote, 3_335_570_470,
            "quote overwritten to the later, true final reserves"
        );
        assert!((price - 0.9163).abs() < 1e-9, "price overwritten to the later, true final value — not stuck at the stale first swap's 0.1006");
    }

    /// A same-slot re-observation (e.g. the ws subscriber's unconditional
    /// baseline re-seed on every reconnect) must NOT migrate its sample into
    /// a different candle bucket just because it happened to land at a later
    /// wall-clock `ts` — only `slot` (unchanged across the conflict) governs
    /// whether this is "the same event". Regression test for the bucket-
    /// migration risk flagged in `insert_price`'s doc comment.
    #[tokio::test]
    async fn same_slot_reobservation_does_not_migrate_the_candle_bucket() {
        let Some(client) = test_client().await else {
            eprintln!("[db_it] TEST_DATABASE_URL unset — skipping Postgres integration test");
            return;
        };
        client
            .batch_execute("TRUNCATE market_price")
            .await
            .expect("truncate");

        // 60s buckets: [0,60) and [60,120). First observation of slot 7 lands
        // at ts=59 — bucket 0. A later re-observation of the SAME slot (same
        // reserves, e.g. a reconnect re-seed) lands at ts=61 — straddling
        // into what would be bucket 60 if `ts` were allowed to drift.
        insert_price(&client, "MktF", 7, 59, 100, 100, 0.50)
            .await
            .unwrap();
        insert_price(&client, "MktF", 7, 61, 100, 100, 0.50)
            .await
            .unwrap();

        let candles = get_candles(&client, "MktF", 60, 100).await.unwrap();
        assert_eq!(
            candles.len(),
            1,
            "the re-observation must stay in bucket 0 with the original sample, not spawn a second bucket at 60"
        );
        assert_eq!(candles[0].time, 0);
    }

    #[tokio::test]
    async fn latest_price_reserves_returns_the_highest_slot_sample() {
        let Some(client) = test_client().await else {
            eprintln!("[db_it] TEST_DATABASE_URL unset — skipping Postgres integration test");
            return;
        };
        client
            .batch_execute("TRUNCATE market_price")
            .await
            .expect("truncate");

        // No samples yet → None (the change-guard then records the first point).
        assert_eq!(latest_price_reserves(&client, "MktC").await.unwrap(), None);

        // Latest is by slot DESC, not insertion order — insert an earlier slot last.
        insert_price(&client, "MktC", 5, 50, 100, 300, 0.75)
            .await
            .unwrap();
        insert_price(&client, "MktC", 2, 20, 100, 100, 0.50)
            .await
            .unwrap();
        assert_eq!(
            latest_price_reserves(&client, "MktC").await.unwrap(),
            Some((100, 300)),
            "slot 5 reserves win over the later-inserted slot 2",
        );

        // A different market must not bleed in.
        assert_eq!(latest_price_reserves(&client, "MktD").await.unwrap(), None);
    }
}
