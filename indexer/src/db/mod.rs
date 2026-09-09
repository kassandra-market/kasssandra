//! Postgres connection for the indexer. Schema lives in `market::db::create_schema`.

use std::sync::Arc;

use anyhow::Result;
use tokio_postgres::{Client, NoTls};

/// Connect and spawn the connection driver. Does not create tables — callers
/// run [`crate::market::db::create_schema`] after connect.
pub async fn connect(database_url: &str) -> Result<Arc<Client>> {
    let (client, connection) = tokio_postgres::connect(database_url, NoTls).await?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            log::error!("postgres connection error: {e}");
        }
    });
    Ok(Arc::new(client))
}
