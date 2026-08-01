#include "mev_kernel.h"

#include <cmath>
#include <limits>

namespace {
bool checked_subtract(int64_t lhs, int64_t rhs, int64_t* output) noexcept {
  if ((rhs > 0 && lhs < std::numeric_limits<int64_t>::min() + rhs) ||
      (rhs < 0 && lhs > std::numeric_limits<int64_t>::max() + rhs)) {
    return false;
  }
  *output = lhs - rhs;
  return true;
}
}  // namespace

extern "C" int32_t mev_evaluate_opportunity(
    const mev_opportunity_input* input, const mev_risk_limits* limits,
    mev_opportunity_output* output) {
  if (input == nullptr || limits == nullptr || output == nullptr) return -1;

  output->expected_net_profit_usd_micros = 0;
  output->rejection_flags = 0;
  output->eligible = 0;

  int64_t net = input->gross_profit_usd_micros;
  const int64_t costs[] = {input->gas_usd_micros, input->relay_usd_micros,
                           input->slippage_usd_micros};
  for (const int64_t cost : costs) {
    if (cost < 0 || !checked_subtract(net, cost, &net)) {
      output->rejection_flags |= MEV_REJECT_OVERFLOW;
      net = std::numeric_limits<int64_t>::min();
      break;
    }
  }
  output->expected_net_profit_usd_micros = net;

  if (input->simulation_succeeded == 0)
    output->rejection_flags |= MEV_REJECT_SIMULATION;
  if (input->data_age_ms > limits->max_data_age_ms)
    output->rejection_flags |= MEV_REJECT_STALE_DATA;
  if (limits->require_protected_route != 0 && input->protected_route == 0)
    output->rejection_flags |= MEV_REJECT_PUBLIC_ROUTE;
  if (input->available_liquidity_usd_micros <
      limits->min_liquidity_usd_micros)
    output->rejection_flags |= MEV_REJECT_LIQUIDITY;
  if (input->calibrated_probability_ppm < limits->min_probability_ppm)
    output->rejection_flags |= MEV_REJECT_PROBABILITY;
  if (net <= 0) output->rejection_flags |= MEV_REJECT_NON_POSITIVE;
  if (input->estimated_latency_ms > limits->max_estimated_latency_ms)
    output->rejection_flags |= MEV_REJECT_LATENCY;
  if (input->notional_usd_micros <= 0 ||
      input->notional_usd_micros > limits->max_notional_usd_micros)
    output->rejection_flags |= MEV_REJECT_NOTIONAL;

  output->eligible = output->rejection_flags == 0 ? 1 : 0;
  return 0;
}

extern "C" double mev_wilson_lower_bound(uint64_t successes, uint64_t trials,
                                           uint32_t z_ppm) {
  if (trials == 0 || successes > trials) return 0.0;
  const double n = static_cast<double>(trials);
  const double p = static_cast<double>(successes) / n;
  const double z = static_cast<double>(z_ppm) / 1000000.0;
  const double z2 = z * z;
  const double center = p + z2 / (2.0 * n);
  const double margin = z * std::sqrt((p * (1.0 - p) / n) +
                                      (z2 / (4.0 * n * n)));
  return (center - margin) / (1.0 + z2 / n);
}
