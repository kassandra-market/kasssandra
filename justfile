# Build the SBF program artifact.
build:
    cargo build-sbf --manifest-path programs/kassandra/Cargo.toml

# Build first, then run the program tests (never test a stale .so).
test: build
    cargo test -p kassandra-program
