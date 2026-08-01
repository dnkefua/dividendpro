export interface SettlementOwnershipInput {
  uid: string;
  txHash: string;
  from: string;
  to: string;
  amountBaseUnits: string;
  chainId: number;
}

export function buildSettlementOwnershipMessage(input: SettlementOwnershipInput): string {
  return [
    "DividendPro Truth Layer Settlement Ownership v1",
    `uid:${input.uid}`,
    `txHash:${input.txHash.toLowerCase()}`,
    `from:${input.from.toLowerCase()}`,
    `to:${input.to.toLowerCase()}`,
    `amountBaseUnits:${input.amountBaseUnits}`,
    `chainId:${input.chainId}`,
  ].join("\n");
}
