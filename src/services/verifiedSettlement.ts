import { BrowserProvider, Contract, getAddress, parseUnits } from "ethers";
import type { User } from "firebase/auth";
import { buildSettlementOwnershipMessage } from "../shared/settlementEvidence";

export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_ID_HEX = "0x38";
export const BSC_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";

const USDT_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

export type SettlementStage = "CONNECTING" | "AWAITING_SIGNATURE" | "SUBMITTED" | "CONFIRMING" | "VERIFYING" | "VERIFIED";

export interface SettlementEvidence {
  schemaVersion: number;
  environment: "LIVE";
  verificationStatus: "VERIFIED_ON_CHAIN";
  walletOwnershipProof: "EIP191_SIGNATURE_VERIFIED";
  uid: string;
  txHash: string;
  chainId: number;
  network: string;
  tokenSymbol: "USDT";
  tokenContract: string;
  tokenDecimals: number;
  from: string;
  to: string;
  amountBaseUnits: string;
  amount: string;
  blockNumber: number;
  blockHash: string;
  transactionIndex: number;
  confirmations: number;
  explorerUrl: string;
}

export class SettlementError extends Error {
  constructor(message: string, public readonly txHash?: string) {
    super(message);
    this.name = "SettlementError";
  }
}

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

async function ensureBscMainnet(ethereum: EthereumProvider): Promise<void> {
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC_CHAIN_ID_HEX }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: BSC_CHAIN_ID_HEX,
        chainName: "BNB Smart Chain Mainnet",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-dataseed1.binance.org/"],
        blockExplorerUrls: ["https://bscscan.com"],
      }],
    });
  }
}

export async function executeVerifiedUsdtSettlement(args: {
  user: User;
  to: string;
  amount: string;
  onProgress?: (stage: SettlementStage, message: string, txHash?: string) => void;
}): Promise<SettlementEvidence> {
  const { user, onProgress } = args;
  const to = getAddress(args.to.trim());
  const amount = args.amount.trim();
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
    throw new SettlementError("Enter a positive USDT amount using numbers only.");
  }

  const ethereum = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!ethereum) throw new SettlementError("No browser wallet was detected. Install or unlock MetaMask/Trust Wallet.");

  onProgress?.("CONNECTING", "Connecting wallet and enforcing BSC Mainnet (chain 56)…");
  await ensureBscMainnet(ethereum);
  await ethereum.request({ method: "eth_requestAccounts" });

  const provider = new BrowserProvider(ethereum as never);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== BSC_CHAIN_ID) throw new SettlementError("Wallet is not connected to BSC Mainnet (chain 56).");

  const signer = await provider.getSigner();
  const from = getAddress(await signer.getAddress());
  const usdt = new Contract(BSC_USDT_ADDRESS, USDT_ABI, signer);
  const decimals = Number(await usdt.decimals());
  const amountBaseUnits = parseUnits(amount, decimals);
  const balance = BigInt((await usdt.balanceOf(from)).toString());
  if (balance < amountBaseUnits) throw new SettlementError("Connected wallet has insufficient BSC USDT balance for this transfer.");

  onProgress?.("AWAITING_SIGNATURE", `Review the ${amount} USDT transfer in your wallet. No funds move until you approve it.`);
  const transaction = await usdt.transfer(to, amountBaseUnits);
  const txHash = String(transaction.hash);
  onProgress?.("SUBMITTED", `Transaction submitted: ${txHash}`, txHash);
  onProgress?.("CONFIRMING", "Waiting for one successful BSC block confirmation…", txHash);

  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new SettlementError("The USDT transaction reverted and was not settled.", txHash);

  onProgress?.("VERIFYING", "Receipt confirmed. Sign the evidence statement (no gas) to bind this wallet to your authenticated account…", txHash);
  const ownershipMessage = buildSettlementOwnershipMessage({
    uid: user.uid,
    txHash,
    from,
    to,
    amountBaseUnits: amountBaseUnits.toString(),
    chainId: BSC_CHAIN_ID,
  });
  const walletSignature = await signer.signMessage(ownershipMessage);
  const idToken = await user.getIdToken();
  const response = await fetch("/api/settlements/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ txHash, from, to, amountBaseUnits: amountBaseUnits.toString(), walletSignature }),
  });
  const result = await response.json() as { evidence?: SettlementEvidence; error?: string };
  if (!response.ok || !result.evidence) {
    throw new SettlementError(
      `The chain transaction succeeded, but evidence verification failed: ${result.error || response.statusText}. Preserve the transaction hash.`,
      txHash,
    );
  }

  onProgress?.("VERIFIED", `Verified on BSC in block ${result.evidence.blockNumber}. Evidence stored under your authenticated account.`, txHash);
  return result.evidence;
}
