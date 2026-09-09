# Build the market SBF program artifact (target/deploy/kassandra_markets_program.so).
build:
    cargo build-sbf --manifest-path programs/markets/Cargo.toml

# Build first, then run the program's tests (never test a stale .so).
test: build
    cargo test --workspace
