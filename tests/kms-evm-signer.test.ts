import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  Signature,
  SigningKey,
  Transaction,
  computeAddress,
  getBytes,
  hexlify,
  recoverAddress,
} from "ethers";
import { KmsEvmSigner, crc32c, parseKmsDerSignature } from "../server/kmsEvmSigner";

const keyVersionName = "projects/dividendpro-3b397/locations/us-east4/keyRings/dividendpro-production/cryptoKeys/mev-executor-signer/cryptoKeyVersions/1";

function derInteger(hex: string): Buffer {
  let scalar = Buffer.from(getBytes(hex));
  while (scalar.length > 1 && scalar[0] === 0) scalar = scalar.subarray(1);
  if ((scalar[0] & 0x80) !== 0) scalar = Buffer.concat([Buffer.from([0]), scalar]);
  return Buffer.concat([Buffer.from([0x02, scalar.length]), scalar]);
}

function derSignature(r: string, s: string): Buffer {
  const body = Buffer.concat([derInteger(r), derInteger(s)]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

test("KMS signer derives its BSC address and creates recoverable chain-56 transactions", async () => {
  const generated = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const privateJwk = generated.privateKey.export({ format: "jwk" });
  assert.ok(privateJwk.d);
  const signingKey = new SigningKey(hexlify(Buffer.from(privateJwk.d, "base64url")));
  const expectedAddress = computeAddress(signingKey.publicKey);
  const pem = generated.publicKey.export({ type: "spki", format: "pem" }).toString();

  const fakeClient = {
    getPublicKey: async () => [{ pem }],
    asymmetricSign: async (request: any) => {
      const digest = Buffer.from(request.digest.sha256);
      assert.equal(request.digestCrc32c.value, crc32c(digest));
      const signature = signingKey.sign(hexlify(digest));
      const der = derSignature(signature.r, signature.s);
      return [{
        signature: der,
        signatureCrc32c: { value: crc32c(der) },
        verifiedDigestCrc32c: true,
      }];
    },
  };

  const signer = new KmsEvmSigner(keyVersionName, expectedAddress, fakeClient as any);
  assert.equal(await signer.getAddress(), expectedAddress);
  const raw = await signer.signTransaction({
    chainId: 56,
    type: 0,
    nonce: 0,
    to: "0x1111111111111111111111111111111111111111",
    value: 0,
    data: "0x",
    gasLimit: 21_000,
    gasPrice: 3_000_000_000,
  });
  const parsed = Transaction.from(raw);
  assert.equal(parsed.from, expectedAddress);
  assert.equal(parsed.chainId, 56n);
  assert.equal(parsed.nonce, 0);
  assert.equal(parsed.to, "0x1111111111111111111111111111111111111111");
});

test("KMS DER parsing rejects malformed signatures", () => {
  assert.throws(() => parseKmsDerSignature(Uint8Array.from([0x30, 0x01, 0x00])), /missing DER r/);
  assert.throws(() => parseKmsDerSignature(Uint8Array.from([0x31, 0x00])), /not a DER sequence/);
});

test("KMS signer pins the derived address", async () => {
  const generated = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const pem = generated.publicKey.export({ type: "spki", format: "pem" }).toString();
  const signer = new KmsEvmSigner(
    keyVersionName,
    "0x1111111111111111111111111111111111111111",
    { getPublicKey: async () => [{ pem }], asymmetricSign: async () => [{}] } as any,
  );
  await assert.rejects(() => signer.getAddress(), /does not match/);
});

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP256K1_HALF_N = SECP256K1_N / 2n;

function scalarHex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

test("KMS high-s signatures are folded into the EIP-2 canonical half", () => {
  // A real key and a real digest, so `r` is an actual curve point and recovery
  // is meaningful. ethers always produces low-s; Cloud KMS does not, and returns
  // the high-s representation of the same signature roughly half the time.
  const key = new SigningKey(`0x${"11".repeat(32)}`);
  const address = computeAddress(key.publicKey);
  const digest = `0x${"ab".repeat(32)}`;
  const canonical = key.sign(digest);

  const highS = SECP256K1_N - BigInt(canonical.s);
  assert.ok(highS > SECP256K1_HALF_N, "fixture must actually be high-s");

  const parsed = parseKmsDerSignature(derSignature(canonical.r, scalarHex(highS)));
  assert.equal(BigInt(parsed.s), BigInt(canonical.s), "high-s must fold back to low-s");
  assert.ok(BigInt(parsed.s) <= SECP256K1_HALF_N, "parsed s must be canonical low-s");

  // How the gap surfaces in production: Signature.from accepts a high-s value,
  // but recoverAddress enforces EIP-2 and throws. That call sits inside
  // signDigest's unguarded parity loop, so the error propagates straight out of
  // signTransaction — failing about one signing attempt in two.
  assert.throws(
    () =>
      recoverAddress(
        digest,
        Signature.from({ r: canonical.r, s: scalarHex(highS), yParity: 0 }),
      ),
    /non-canonical s/,
  );

  // After normalisation one of the two parities recovers the true signer, which
  // is exactly what signDigest's loop relies on.
  const recovered = ([0, 1] as const).map((yParity) =>
    recoverAddress(digest, Signature.from({ r: parsed.r, s: parsed.s, yParity })),
  );
  assert.ok(recovered.includes(address), "normalised signature must recover the signer");
});

test("KMS low-s signatures pass through unchanged", () => {
  const r = `0x${"11".repeat(32)}`;
  const lowS = `0x${"22".repeat(32)}`;
  assert.ok(BigInt(lowS) <= SECP256K1_HALF_N, "fixture must actually be low-s");
  assert.equal(parseKmsDerSignature(derSignature(r, lowS)).s, lowS);
});
