#include "mev_kernel.h"

#include <cassert>
#include <cmath>

int main() {
  mev_opportunity_input input{};
  input.gross_profit_usd_micros = 1700000;
  input.gas_usd_micros = 120000;
  input.relay_usd_micros = 30000;
  input.slippage_usd_micros = 90000;
  input.notional_usd_micros = 20000000;
  input.available_liquidity_usd_micros = 5000000000;
  input.calibrated_probability_ppm = 930000;
  input.data_age_ms = 120;
  input.estimated_latency_ms = 180;
  input.simulation_succeeded = 1;
  input.protected_route = 1;

  mev_risk_limits limits{};
  limits.max_notional_usd_micros = 25000000;
  limits.min_liquidity_usd_micros = 100000000;
  limits.min_probability_ppm = 850000;
  limits.max_data_age_ms = 900;
  limits.max_estimated_latency_ms = 1000;
  limits.require_protected_route = 1;

  mev_opportunity_output output{};
  assert(mev_evaluate_opportunity(&input, &limits, &output) == 0);
  assert(output.eligible == 1);
  assert(output.rejection_flags == 0);
  assert(output.expected_net_profit_usd_micros == 1460000);

  input.protected_route = 0;
  assert(mev_evaluate_opportunity(&input, &limits, &output) == 0);
  assert(output.eligible == 0);
  assert((output.rejection_flags & MEV_REJECT_PUBLIC_ROUTE) != 0);

  const double lower = mev_wilson_lower_bound(190, 200, 1644854);
  assert(lower > 0.90 && lower < 0.95);
  assert(mev_wilson_lower_bound(0, 0, 1644854) == 0.0);
  return 0;
}
