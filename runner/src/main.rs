//! `kassandra-runner` CLI entrypoint.
//!
//! Thin wrapper: argument parsing + the `run` / `verify` orchestration live in
//! [`kassandra_runner::cli`] (so the core is library-testable with mocks); this
//! just provides the async runtime and prints errors.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    kassandra_runner::cli::run_cli().await
}
