FROM rust:1.89-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock* build.rs ./
COPY cpp ./cpp
COPY src ./src
RUN cargo test --locked
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN useradd --create-home --uid 10001 mevworker
COPY --from=builder /build/target/release/dividendpro-mev /usr/local/bin/dividendpro-mev
USER 10001
ENV PORT=8081
EXPOSE 8081
ENTRYPOINT ["/usr/local/bin/dividendpro-mev"]
