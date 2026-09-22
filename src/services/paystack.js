const PAYSTACK_BASE_URL = "https://api.paystack.co";
function getSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
const crypto = require("crypto");

function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) {
    return false;
  }
  const hash = crypto
    .createHmac("sha512", getSecretKey())
    .update(rawBody)
    .digest("hex");
  return hash === signatureHeader;
}
  }
  return key;
}
async function paystackRequest(path, options = {}) {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok || !data.status) {
    throw new Error(
      data.message || `Paystack request failed with status ${response.status}.`
    );
  }
  return data;
}
async function initializeTransaction({
  email,
  amount,
  reference,
  callbackUrl = null,
}) {
  if (!email || typeof email !== "string") {
    throw new Error("A valid customer email is required.");
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("A valid payment amount is required.");
  }
  if (!reference || typeof reference !== "string") {
    throw new Error("A valid payment reference is required.");
  }
  const body = {
    email,
    amount: Math.round(numericAmount * 100),
    reference,
  };
  if (callbackUrl) {
    body.callback_url = callbackUrl;
  }
  const result = await paystackRequest("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return result.data;
}
async function verifyTransaction(reference) {
  if (!reference || typeof reference !== "string") {
    throw new Error("A valid payment reference is required.");
  }
  const result = await paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
  return result.data;
}
module.exports = {
  initializeTransaction,
  verifyTransaction,
};
const crypto = require("crypto");

function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) {
    return false;
  }
  const hash = crypto
    .createHmac("sha512", getSecretKey())
    .update(rawBody)
    .digest("hex");
  return hash === signatureHeader;
}
