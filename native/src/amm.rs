//! Constant-product (PancakeSwap v2 / UniswapV2) route mathematics.
//!
//! This module owns every number that decides whether a route is worth taking.
//! Two rules govern everything here:
//!
//! 1. **Accept/reject decisions are made in exact integer arithmetic.** Floating
//!    point appears in exactly one place (`closed_form_optimum`), and only as a
//!    *seed* — it can influence which size we try, never whether we believe a
//!    size is profitable. A wrong f64 rounding costs basis points of yield; a
//!    wrong integer comparison costs the trade.
//!
//! 2. **Every arithmetic path is overflow-checked and saturates to "no profit".**
//!    An overflow is never allowed to wrap into an apparently profitable number.
//!
//! ## Why optimal sizing matters
//!
//! The scanner previously quoted a single fixed `amountIn` from configuration.
//! For a constant-product cycle the profit function is strictly concave, so a
//! fixed size is wrong in both directions: below the optimum it leaves yield
//! unclaimed, above it the marginal unit is sold into worse depth than it was
//! bought at and profit falls back toward — and then through — zero. The size
//! that was optimal when the config was written stops being optimal the moment
//! reserves move, which on BSC is every 0.45s block.

/// Exact PancakeSwap-style constant-product quote for a single hop.
///
/// Mirrors `UniswapV2Library.getAmountOut` including its integer truncation, so
/// that a quote computed here matches what the router will actually execute.
/// Returns 0 for any degenerate or overflowing input — never a partial result.
pub fn amount_out(amount_in: u128, reserve_in: u128, reserve_out: u128, fee_bps: u32) -> u128 {
    if amount_in == 0 || reserve_in == 0 || reserve_out == 0 || fee_bps >= 10_000 {
        return 0;
    }
    let fee_multiplier = 10_000_u128 - fee_bps as u128;
    let Some(amount_with_fee) = amount_in.checked_mul(fee_multiplier) else {
        return 0;
    };
    let Some(numerator) = amount_with_fee.checked_mul(reserve_out) else {
        return 0;
    };
    let denominator = match reserve_in
        .checked_mul(10_000)
        .and_then(|value| value.checked_add(amount_with_fee))
    {
        Some(value) if value > 0 => value,
        _ => return 0,
    };
    numerator / denominator
}

/// The two legs of a buy-then-sell cycle that returns to the input token.
///
/// `buy_*` is the pool the input token is sold into; `sell_*` is the pool the
/// intermediate token is sold back through. Reserves must already be oriented
/// (in, out) for the direction of travel — the caller resolves token0/token1.
#[derive(Clone, Copy, Debug)]
pub struct CycleLegs {
    pub buy_reserve_in: u128,
    pub buy_reserve_out: u128,
    pub buy_fee_bps: u32,
    pub sell_reserve_in: u128,
    pub sell_reserve_out: u128,
    pub sell_fee_bps: u32,
}

impl CycleLegs {
    /// Amount of the input token recovered after both hops.
    pub fn round_trip_out(&self, amount_in: u128) -> u128 {
        let intermediate = amount_out(
            amount_in,
            self.buy_reserve_in,
            self.buy_reserve_out,
            self.buy_fee_bps,
        );
        amount_out(
            intermediate,
            self.sell_reserve_in,
            self.sell_reserve_out,
            self.sell_fee_bps,
        )
    }

    /// Gross profit in input-token base units. Saturates to 0 on a loss, so the
    /// caller can never read a loss as an unsigned "profit".
    pub fn gross_profit(&self, amount_in: u128) -> u128 {
        self.round_trip_out(amount_in).saturating_sub(amount_in)
    }
}

/// Result of an optimal-size search.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct OptimalSize {
    pub amount_in: u128,
    pub gross_profit: u128,
}

/// Closed-form profit-maximising input size, evaluated in f64.
///
/// Composing the two hops gives `out(x) = A·x / (B + C·x)` with
///
/// ```text
///   A = f1·f2·R1out·R2out
///   B = 10^8·R1in·R2in            (10^8 = 10000², the two fee denominators)
///   C = f1·(10000·R2in + f2·R1out)
///   f = 10000 − fee_bps
/// ```
///
/// `profit(x) = out(x) − x` is concave, so `d/dx = A·B/(B + C·x)² − 1 = 0`
/// yields `x* = (√(A·B) − B) / C`, and a profitable size exists **iff A > B**.
///
/// This is computed in f64 because `A·B` reaches ~10^96 for real pools and
/// overflows u128 (max ~3.4·10^38) — carrying it exactly would need 256-bit
/// arithmetic and a new dependency. f64 is used only to seed and to fast-reject;
/// the returned size is re-scored exactly by [`optimal_amount_in`].
///
/// Returns `None` when no profitable size exists at these reserves.
pub fn closed_form_optimum(legs: &CycleLegs) -> Option<u128> {
    if legs.buy_fee_bps >= 10_000 || legs.sell_fee_bps >= 10_000 {
        return None;
    }
    let f1 = (10_000 - legs.buy_fee_bps) as f64;
    let f2 = (10_000 - legs.sell_fee_bps) as f64;
    let r1_in = legs.buy_reserve_in as f64;
    let r1_out = legs.buy_reserve_out as f64;
    let r2_in = legs.sell_reserve_in as f64;
    let r2_out = legs.sell_reserve_out as f64;

    let a = f1 * f2 * r1_out * r2_out;
    let b = 1.0e8 * r1_in * r2_in;
    // A <= B means the cycle is underwater at every size. This is the common
    // case on the overwhelming majority of blocks and is the cheapest possible
    // rejection — one multiply-compare, no search.
    if !(a > b) {
        return None;
    }
    let c = f1 * (10_000.0 * r2_in + f2 * r1_out);
    if !(c > 0.0) {
        return None;
    }
    let x = ((a * b).sqrt() - b) / c;
    if !x.is_finite() || x <= 0.0 || x >= u128::MAX as f64 {
        return None;
    }
    Some(x as u128)
}

/// Profit-maximising input size over `[1, cap]`, decided in exact integer math.
///
/// Ternary search over a concave integer function. Each iteration strictly
/// shrinks the bracket by at least one unit (and by ~1/3 while the bracket is
/// wide), so the loop is guaranteed to terminate without an iteration cap —
/// roughly 215 iterations to collapse a full u128 range.
///
/// `cap` is a hard ceiling and is never exceeded: it carries the operator's
/// configured maximum notional, so optimal sizing can only ever size *down*
/// from the previously configured fixed amount, never up past the risk limit.
pub fn optimal_amount_in(legs: &CycleLegs, cap: u128) -> OptimalSize {
    let mut best = OptimalSize::default();
    if cap == 0 {
        return best;
    }
    // Fast reject: if the closed form says no size is profitable, no size is.
    if closed_form_optimum(legs).is_none() {
        return best;
    }

    let (mut lo, mut hi) = (1_u128, cap);
    while hi - lo >= 3 {
        let third = (hi - lo) / 3;
        let m1 = lo + third;
        let m2 = hi - third;
        // Strict shrinkage: third >= 1 whenever hi - lo >= 3, so m1 > lo and
        // m2 < hi. Termination is therefore guaranteed.
        if legs.gross_profit(m1) < legs.gross_profit(m2) {
            lo = m1;
        } else {
            hi = m2;
        }
    }

    // Exhaustively score the <=3 survivors. Integer truncation can leave tiny
    // plateaus that a pure ternary search may land beside; this closes that gap.
    let mut candidate = lo;
    loop {
        let profit = legs.gross_profit(candidate);
        if profit > best.gross_profit {
            best = OptimalSize {
                amount_in: candidate,
                gross_profit: profit,
            };
        }
        if candidate >= hi {
            break;
        }
        match candidate.checked_add(1) {
            Some(next) => candidate = next,
            None => break,
        }
    }
    best
}

// ─────────────────────────────────────────────────────────────────────────────
// Router cross-check encoding
//
// Reserve math describes what a *well-behaved* pair will do. It is silent about
// fee-on-transfer tokens, rebasing tokens, blacklists, and pairs whose router
// applies a different fee than assumed — each of which makes reserve math read
// profitable on a route that cannot actually be executed. Quoting the real
// router at the same pinned block is the cheap check that catches all of them.
// ─────────────────────────────────────────────────────────────────────────────

/// `getAmountsOut(uint256,address[])` selector.
const GET_AMOUNTS_OUT_SELECTOR: &str = "d06ca61f";

/// ABI-encode a `getAmountsOut` call for a router cross-check.
///
/// Layout: selector ‖ amountIn ‖ offset(0x40) ‖ path.len ‖ path[0..n]
pub fn encode_get_amounts_out(amount_in: u128, path: &[String]) -> anyhow::Result<String> {
    if path.len() < 2 {
        anyhow::bail!("swap path needs at least two tokens");
    }
    let mut encoded = String::from("0x");
    encoded.push_str(GET_AMOUNTS_OUT_SELECTOR);
    encoded.push_str(&format!("{amount_in:0>64x}"));
    // Offset to the dynamic array: two head words (amountIn, offset) = 0x40.
    encoded.push_str(&format!("{:0>64x}", 0x40));
    encoded.push_str(&format!("{:0>64x}", path.len()));
    for token in path {
        let normalized = crate::rpc::normalize_address(token)?;
        encoded.push_str(&format!("{:0>64}", &normalized[2..]));
    }
    Ok(encoded)
}

/// Decode the final element of the `uint256[]` returned by `getAmountsOut`.
pub fn decode_final_amount(raw: &str) -> anyhow::Result<u128> {
    let data = raw.trim_start_matches("0x");
    // head(offset) + length + at least one element
    if data.len() < 192 || data.len() % 64 != 0 {
        anyhow::bail!("getAmountsOut returned a malformed dynamic array");
    }
    let length = u128::from_str_radix(&data[64..128], 16)
        .map_err(|_| anyhow::anyhow!("getAmountsOut length word is not valid hex"))?;
    if length < 2 {
        anyhow::bail!("getAmountsOut returned fewer than two amounts");
    }
    let expected_words = 2 + length as usize;
    if data.len() / 64 < expected_words {
        anyhow::bail!("getAmountsOut array is shorter than its declared length");
    }
    let last_word_start = 128 + (length as usize - 1) * 64;
    crate::rpc::parse_hex_u128(&format!("0x{}", &data[last_word_start..last_word_start + 64]))
}

/// Does the router's own quote agree with our reserve math?
///
/// A router quote *below* tolerance is the dangerous direction — it means the
/// route yields less than modelled (fee-on-transfer being the usual cause), so
/// the opportunity is rejected. A quote above tolerance is also rejected: it
/// means our model of the pair is wrong, and an unexplained model is not a
/// licence to send funds.
pub fn quotes_agree(modelled: u128, router: u128, tolerance_bps: u32) -> bool {
    if modelled == 0 || router == 0 {
        return false;
    }
    let (larger, smaller) = if modelled > router {
        (modelled, router)
    } else {
        (router, modelled)
    };
    let Some(scaled) = (larger - smaller).checked_mul(10_000) else {
        return false;
    };
    scaled / larger <= tolerance_bps as u128
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legs(r1i: u128, r1o: u128, r2i: u128, r2o: u128) -> CycleLegs {
        CycleLegs {
            buy_reserve_in: r1i,
            buy_reserve_out: r1o,
            buy_fee_bps: 25,
            sell_reserve_in: r2i,
            sell_reserve_out: r2o,
            sell_fee_bps: 25,
        }
    }

    #[test]
    fn constant_product_quote_charges_fee() {
        // Preserves the behaviour previously asserted in scanner.rs.
        assert_eq!(amount_out(1_000, 1_000_000, 2_000_000, 25), 1_993);
        assert_eq!(amount_out(0, 1_000, 1_000, 25), 0);
    }

    #[test]
    fn balanced_pools_have_no_profitable_size() {
        // Identical pricing on both legs: fees alone guarantee a loss.
        let balanced = legs(1_000_000, 1_000_000, 1_000_000, 1_000_000);
        assert!(closed_form_optimum(&balanced).is_none());
        assert_eq!(optimal_amount_in(&balanced, 1_000_000), OptimalSize::default());
    }

    #[test]
    fn dislocated_pools_expose_a_bounded_optimum() {
        // Second pool prices the intermediate token 20% richer.
        let dislocated = legs(1_000_000, 1_000_000, 1_000_000, 1_200_000);
        let best = optimal_amount_in(&dislocated, 1_000_000);
        assert!(best.gross_profit > 0);
        assert!(best.amount_in > 0);
        // The searched size must beat both a much smaller and a much larger one.
        assert!(best.gross_profit >= dislocated.gross_profit(best.amount_in / 4));
        assert!(best.gross_profit >= dislocated.gross_profit(best.amount_in * 4));
    }

    #[test]
    fn optimum_never_exceeds_the_cap() {
        let dislocated = legs(10_000_000, 10_000_000, 10_000_000, 30_000_000);
        let cap = 1_000_u128;
        let best = optimal_amount_in(&dislocated, cap);
        assert!(best.amount_in <= cap);
    }

    #[test]
    fn search_agrees_with_the_closed_form_seed() {
        let dislocated = legs(5_000_000, 5_000_000, 5_000_000, 6_500_000);
        let seed = closed_form_optimum(&dislocated).expect("profitable");
        let best = optimal_amount_in(&dislocated, u128::MAX / 2);
        // The exact search must never be beaten by the f64 seed.
        assert!(best.gross_profit >= dislocated.gross_profit(seed));
    }

    #[test]
    fn zero_cap_yields_nothing() {
        let dislocated = legs(1_000_000, 1_000_000, 1_000_000, 1_200_000);
        assert_eq!(optimal_amount_in(&dislocated, 0), OptimalSize::default());
    }

    #[test]
    fn get_amounts_out_encoding_is_well_formed() {
        let path = vec![
            "0x55d398326f99059ff775485246999027b3197955".to_string(),
            "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c".to_string(),
        ];
        let encoded = encode_get_amounts_out(1_000, &path).expect("encodes");
        // "0x" + selector(8) + five 32-byte words:
        // amountIn, array offset, array length, path[0], path[1].
        assert_eq!(encoded.len(), 2 + 8 + 64 * 5);
        assert!(encoded.starts_with("0xd06ca61f"));
        assert!(encoded.ends_with("bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"));
    }

    #[test]
    fn decodes_final_amount_from_dynamic_array() {
        let raw = format!(
            "0x{:0>64x}{:0>64x}{:0>64x}{:0>64x}",
            0x20, 2, 1_000, 1_993
        );
        assert_eq!(decode_final_amount(&raw).expect("decodes"), 1_993);
    }

    #[test]
    fn rejects_truncated_router_response() {
        let raw = format!("0x{:0>64x}{:0>64x}", 0x20, 5);
        assert!(decode_final_amount(&raw).is_err());
    }

    #[test]
    fn quote_agreement_is_symmetric_and_bounded() {
        assert!(quotes_agree(1_000, 1_000, 0));
        assert!(quotes_agree(1_000, 995, 50));
        assert!(!quotes_agree(1_000, 900, 50));
        // Fee-on-transfer direction: router pays less than modelled.
        assert!(!quotes_agree(1_000, 800, 100));
        // Unexplained upside is rejected too.
        assert!(!quotes_agree(800, 1_000, 100));
        assert!(!quotes_agree(0, 1_000, 100));
    }
}
