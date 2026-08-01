import crypto from "node:crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import {
  Signature,
  Transaction,
  computeAddress,
  getAddress,
  getBytes,
  hexlify,
  recoverAddress,
  type TransactionLike,
} from "ethers";

const KMS_KEY_VERSION_PATTERN = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]*$/;
const SECP256K1_SCALAR_BYTES = 32;

type KmsClient = Pick<KeyManagementServiceClient, "getPublicKey" | "asymmetricSign">;

function base64UrlBytes(value: string | undefined): Buffer {
  if (!value) throw new Error("KMS public key is missing a curve coordinate.");
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function fixedScalar(value: Buffer, label: string): string {
  let normalized = value;
  while (normalized.length > 1 && normalized[0] === 0) normalized = normalized.subarray(1);
  if (normalized.length > SECP256K1_SCALAR_BYTES) throw new Error(`KMS ${label} scalar exceeds secp256k1 width.`);
  return hexlify(Buffer.concat([Buffer.alloc(SECP256K1_SCALAR_BYTES - normalized.length), normalized]));
}

function readDerLength(bytes: Buffer, offset: number): { length: number; next: number } {
  const first = bytes[offset];
  if (first === undefined) throw new Error("KMS signature has a truncated DER length.");
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const lengthBytes = first & 0x7f;
  if (lengthBytes === 0 || lengthBytes > 2 || offset + 1 + lengthBytes > bytes.length) {
    throw new Error("KMS signature has an unsupported DER length.");
  }
  let length = 0;
  for (let i = 0; i < lengthBytes; i += 1) length = (length << 8) | bytes[offset + 1 + i];
  return { length, next: offset + 1 + lengthBytes };
}

export function parseKmsDerSignature(der: Uint8Array): { r: string; s: string } {
  const bytes = Buffer.from(der);
  if (bytes[0] !== 0x30) throw new Error("KMS signature is not a DER sequence.");
  const sequence = readDerLength(bytes, 1);
  if (sequence.next + sequence.length !== bytes.length) throw new Error("KMS signature DER sequence length is invalid.");

  let cursor = sequence.next;
  if (bytes[cursor] !== 0x02) throw new Error("KMS signature is missing DER r.");
  const rLength = readDerLength(bytes, cursor + 1);
  const r = bytes.subarray(rLength.next, rLength.next + rLength.length);
  cursor = rLength.next + rLength.length;
  if (r.length === 0 || cursor >= bytes.length || bytes[cursor] !== 0x02) {
    throw new Error("KMS signature has an invalid DER r scalar.");
  }

  const sLength = readDerLength(bytes, cursor + 1);
  const s = bytes.subarray(sLength.next, sLength.next + sLength.length);
  cursor = sLength.next + sLength.length;
  if (s.length === 0 || cursor !== bytes.length) throw new Error("KMS signature has an invalid DER s scalar.");
  return { r: fixedScalar(r, "r"), s: fixedScalar(s, "s") };
}

export function crc32c(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
    }
  }
  return (~crc) >>> 0;
}

function int64Value(value: unknown): number {
  if (value && typeof value === "object" && "value" in value) {
    return Number(String((value as { value: unknown }).value));
  }
  return Number.NaN;
}

export class KmsEvmSigner {
  readonly keyVersionName: string;
  readonly expectedAddress?: string;
  private readonly client: KmsClient;
  private addressPromise?: Promise<string>;

  constructor(keyVersionName: string, expectedAddress?: string, client: KmsClient = new KeyManagementServiceClient()) {
    if (!KMS_KEY_VERSION_PATTERN.test(keyVersionName)) throw new Error("MEV_KMS_KEY_VERSION is not a valid KMS key-version resource name.");
    this.keyVersionName = keyVersionName;
    this.expectedAddress = expectedAddress ? getAddress(expectedAddress) : undefined;
    this.client = client;
  }

  async getAddress(): Promise<string> {
    if (!this.addressPromise) this.addressPromise = this.loadAddress();
    return this.addressPromise;
  }

  private async loadAddress(): Promise<string> {
    const [response] = await this.client.getPublicKey({ name: this.keyVersionName });
    if (!response.pem) throw new Error("KMS returned no public key PEM.");
    const jwk = crypto.createPublicKey(response.pem).export({ format: "jwk" });
    if (jwk.kty !== "EC" || jwk.crv !== "secp256k1") throw new Error("KMS key is not secp256k1.");
    const x = base64UrlBytes(jwk.x);
    const y = base64UrlBytes(jwk.y);
    if (x.length !== 32 || y.length !== 32) throw new Error("KMS secp256k1 coordinates are invalid.");
    const address = getAddress(computeAddress(hexlify(Buffer.concat([Buffer.from([4]), x, y]))));
    if (this.expectedAddress && address !== this.expectedAddress) {
      throw new Error("KMS public key does not match MEV_EXECUTION_SIGNER_ADDRESS.");
    }
    return address;
  }

  private async signDigest(digestHex: string): Promise<Signature> {
    const digest = Buffer.from(getBytes(digestHex));
    if (digest.length !== 32) throw new Error("EVM transaction digest must be 32 bytes.");
    const digestCrc32c = crc32c(digest);
    const [response] = await this.client.asymmetricSign({
      name: this.keyVersionName,
      digest: { sha256: digest },
      digestCrc32c: { value: digestCrc32c },
    });
    if (response.verifiedDigestCrc32c !== true) throw new Error("KMS did not verify the transaction digest checksum.");
    if (!response.signature) throw new Error("KMS returned no signature.");
    const der = typeof response.signature === "string"
      ? Buffer.from(response.signature, "base64")
      : Buffer.from(response.signature);
    if (int64Value(response.signatureCrc32c) !== crc32c(der)) {
      throw new Error("KMS signature checksum verification failed.");
    }
    const { r, s } = parseKmsDerSignature(der);
    const address = await this.getAddress();
    for (const yParity of [0, 1] as const) {
      const signature = Signature.from({ r, s, yParity });
      if (getAddress(recoverAddress(digestHex, signature)) === address) return signature;
    }
    throw new Error("KMS signature cannot be recovered to the configured signer address.");
  }

  async signTransaction(transactionLike: TransactionLike<string>): Promise<string> {
    const transaction = Transaction.from(transactionLike);
    if (!transaction.isLegacy() || transaction.chainId !== 56n) {
      throw new Error("KMS signer accepts only legacy BSC chain-56 transactions.");
    }
    transaction.signature = await this.signDigest(transaction.unsignedHash);
    if (getAddress(transaction.from || "") !== await this.getAddress()) {
      throw new Error("Signed transaction sender does not match the KMS signer.");
    }
    return transaction.serialized;
  }
}

export function configuredKmsSigner(): KmsEvmSigner {
  const keyVersionName = process.env.MEV_KMS_KEY_VERSION || "";
  const expectedAddress = process.env.MEV_EXECUTION_SIGNER_ADDRESS || "";
  if (!keyVersionName || !expectedAddress) {
    throw new Error("Server-side KMS signer is not configured.");
  }
  return new KmsEvmSigner(keyVersionName, expectedAddress);
}

export async function verifyConfiguredKmsSigner(): Promise<string> {
  const signer = configuredKmsSigner();
  const address = await signer.getAddress();
  // This proves the runtime identity can use the HSM without creating a
  // broadcastable production action. The deliberately unreachable nonce and
  // one-wei gas price keep the discarded self-test transaction inert even if
  // its bytes were ever exposed through an unrelated runtime failure.
  const serialized = await signer.signTransaction({
    chainId: 56,
    type: 0,
    nonce: Number.MAX_SAFE_INTEGER,
    to: address,
    value: 0,
    data: "0x",
    gasLimit: 21_000,
    gasPrice: 1,
  });
  const recovered = Transaction.from(serialized).from;
  if (!recovered || getAddress(recovered) !== address) throw new Error("KMS signer self-test recovery failed.");
  return address;
}
