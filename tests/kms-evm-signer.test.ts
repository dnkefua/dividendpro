import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  SigningKey,
  Transaction,
  computeAddress,
  getBytes,
  hexlify,
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
