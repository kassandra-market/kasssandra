//! Kassandra indexer — one Carbon pipeline for the kassandra-markets program,
//! one Postgres, one axum read API.
//!
//! Indexes the program's *accounts* (gpa snapshot + optional program-subscribe
//! live tail → `market_accounts`), with a periodic getProgramAccounts reconcile
//! that also prunes closed accounts. Serves `/health` and `/api/*`. Ctrl-C
//! shuts the process down; the pipeline is non-fatal (reconcile keeps accounts
//! fresh if it exits).

mod config;
mod db;
mod market;
mod ratelimit;
mod reconcile;

use std::str::FromStr;
use std::sync::Arc;

use anyhow::{Context, Result};
use carbon_core::pipeline::Pipeline;
use carbon_rpc_gpa_datasource::GpaDatasource;
use carbon_rpc_program_subscribe_datasource::{Filters as SubscribeFilters, RpcProgramSubscribe};
use solana_pubkey::Pubkey;

use crate::config::{env_num, ws_url_for_prices};
use crate::market::rpc::Rpc as MarketRpc;
use crate::reconcile::market_reconcile_loop;

/// Subscribe-mode snapshot cadence (ms): the ws tail handles freshness, so this
/// slower getProgramAccounts pass only needs to prune accounts closed on-chain.
const MARKET_PRUNE_INTERVAL_MS: u64 = 60_000;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let rpc_url = std::env::var("RPC_URL")
        .or_else(|_| std::env::var("SOLANA_RPC_URL"))
        .context("RPC_URL (or SOLANA_RPC_URL) is required")?;
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL is required")?;
    let port: u16 = env_num("PORT", 3000);

    let client = db::connect(&database_url).await?;
    market::db::create_schema(&client).await?;

    let market_program_id = match std::env::var("MARKET_PROGRAM_ID") {
        Ok(s) => Pubkey::from_str(&s).context("invalid MARKET_PROGRAM_ID")?,
        Err(_) => market::default_program_id(),
    };
    // >0 => run the periodic getProgramAccounts reconcile as the freshness path
    // (for RPCs without a working ws `programSubscribe`, e.g. surfpool in the e2e).
    let market_reconcile_ms: u64 = env_num("INDEXER_RECONCILE_MS", 0);
    let market_rpc = Arc::new(MarketRpc::new(rpc_url.clone()));

    {
        let market_state = market::api::AppState {
            client: client.clone(),
            rpc: Some(market_rpc.clone()),
            rpc_url: rpc_url.clone(),
            http: reqwest::Client::new(),
            rpc_rate: Arc::new(ratelimit::RateLimiter::new(100.0, 50.0)),
        };
        let app = market::api::router(market_state);
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
        log::info!("[indexer] API listening on :{port}");
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                log::error!("api server error: {e}");
            }
        });
    }

    // Market account pipeline: gpa snapshot always; the live program-subscribe tail
    // only when NOT reconciling and a ws url is set (reconcile mode replaces the ws
    // tail with polling). The pipeline is non-fatal — if it dies, the reconcile loop
    // keeps `market_accounts` correct (degraded freshness in subscribe mode).
    {
        let gpa = GpaDatasource::new(rpc_url.clone(), market_program_id);
        let mut builder = Pipeline::builder().datasource(gpa);
        if market_reconcile_ms == 0 {
            match std::env::var("SOLANA_WS_URL") {
                Ok(ws_url) => {
                    builder = builder.datasource(RpcProgramSubscribe::new(
                        ws_url,
                        SubscribeFilters::new(market_program_id, None),
                    ));
                }
                Err(_) => log::warn!(
                    "[market] no SOLANA_WS_URL and INDEXER_RECONCILE_MS=0; gpa snapshot + prune only"
                ),
            }
        }
        let mut market_pipeline = builder
            .account(
                market::decoder::KassandraAccountDecoder {
                    program_id: market_program_id,
                },
                market::processor::KassandraAccountProcessor {
                    client: client.clone(),
                },
            )
            .build()?;
        let reconcile_interval = if market_reconcile_ms > 0 {
            market_reconcile_ms
        } else {
            MARKET_PRUNE_INTERVAL_MS
        };
        log::info!(
            "[market] program {market_program_id}; reconcile_ms={market_reconcile_ms}; pipeline starting"
        );
        tokio::spawn(async move {
            if let Err(e) = market_pipeline.run().await {
                log::warn!("[market] pipeline exited (reconcile keeps accounts fresh): {e}");
            }
        });
        tokio::spawn(market_reconcile_loop(
            market_rpc.clone(),
            client.clone(),
            market_program_id,
            reconcile_interval,
        ));

        // Per-market AMM price subscription → the `market_price` candle series.
        // Event-driven (one point per swap, wall-clock stamped) via websocket
        // `accountSubscribe`, so it needs a ws url: SOLANA_WS_URL if set, else
        // derived from the RPC url (http→ws, port+1 — the local/surfpool default).
        match ws_url_for_prices(&rpc_url) {
            Some(ws_url) => {
                tokio::spawn(market::price_subscribe::run_price_subscriber(
                    ws_url,
                    market_rpc.clone(),
                    client.clone(),
                ));
            }
            None => log::warn!(
                "[market-price] no SOLANA_WS_URL and RPC url not ws-derivable; candle series disabled"
            ),
        }
    }

    tokio::signal::ctrl_c().await?;
    log::info!("[indexer] SIGINT — shutting down");
    Ok(())
}
