#ifndef DIVIDENDPRO_MEV_KERNEL_H
#define DIVIDENDPRO_MEV_KERNEL_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif
enum mev_rejection_flag {
  MEV_REJECT_SIMULATION = 1u << 0,
  MEV_REJECT_STALE_DATA = 1u << 1,
  MEV_REJECT_PUBLIC_ROUTE = 1u << 2,
  MEV_REJECT_LIQUIDITY = 1u << 3,
  MEV_REJECT_PROBABILITY = 1u << 4,
  MEV_REJECT_NON_POSITIVE = 1u << 5,
  MEV_REJECT_LATENCY = 1u << 6,
  MEV_REJECT_NOTIONAL = 1u << 7,
  MEV_REJECT_OVERFLOW = 1u << 8
};

typedef struct mev_opportunity_input {
  int64_t gross_profit_usd_micros;
  int64_t gas_usd_micros;
  int64_t relay_usd_micros;
  int64_t slippage_usd_micros;
  int64_t notional_usd_micros;
  int64_t available_liquidity_usd_micros;
  uint32_t calibrated_probability_ppm;
  uint32_t data_age_ms;
  uint32_t estimated_latency_ms;
  uint8_t simulation_succeeded;
  uint8_t protected_route;
  uint8_t reserved[6];
} mev_opportunity_input;

typedef struct mev_risk_limits {
  int64_t max_notional_usd_micros;
  int64_t min_liquidity_usd_micros;
  uint32_t min_probability_ppm;
  uint32_t max_data_age_ms;
  uint32_t max_estimated_latency_ms;
  uint8_t require_protected_route;
  uint8_t reserved[7];
} mev_risk_limits;

typedef struct mev_opportunity_output {
  int64_t expected_net_profit_usd_micros;
  uint32_t rejection_flags;
  uint8_t eligible;
  uint8_t reserved[3];
} mev_opportunity_output;

// Returns 0 for a valid evaluation and -1 for null pointers.
int32_t mev_evaluate_opportunity(const mev_opportunity_input* input,
                                 const mev_risk_limits* limits,
                                 mev_opportunity_output* output);

// One-sided Wilson lower confidence bound. z is represented in millionths.
double mev_wilson_lower_bound(uint64_t successes, uint64_t trials,
                              uint32_t z_ppm);

#ifdef __cplusplus
}
#endif

#endif
