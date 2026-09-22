const crypto = require("crypto");
const { z } = require("zod");
const {
  initializePayment,
  verifyAndConfirmPayment,
} = require("../services/payment");
const { verifyWebhookSignature } = require("../services/paystack");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const initSchema = z.object({
  amount: z.number().positive(),
  callbackUrl: z.string().url().optional(),
});

async function initialize(req, res) {
  const parsed = initSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const reference = `WALLET-FUND-${req.user.id}-${Date.now()}`;

  try {
    const result = await initializePayment({
      userId: req.user.id,
      reference,
      amount: parsed.data.amount,
      callbackUrl: parsed.data.callbackUrl,
    });

    return res.status(201).json({
      reference: result.payment.reference,
      authorizationUrl: result.paystack.authorization_url,
      accessCode: result.paystack.access_code,
    });
  } catch (error) {
    return res.status(422).json({ error: error.message });
  }
}

async function getStatus(req, res) {
  const { reference } = req.params;

  const payment = await prisma.payment.findUnique({ where: { reference } });

  if (!payment || payment.userId !== req.user.id) {
    return res.status(404).json({ error: "Payment not found." });
  }

  return res.status(200).json({ payment });
}

async function webhook(req, res) {
  const signature = req.headers["x-paystack-signature"];
  const rawBody = req.body; // Buffer, from express.raw() middleware

  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ error: "Invalid signature." });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    return res.status(400).json({ error: "Invalid JSON payload." });
  }

  // Acknowledge immediately; Paystack retries on non-2xx or timeout.
  res.status(200).json({ received: true });

  if (event.event !== "charge.success") {
    return;
  }

  const reference = event.data && event.data.reference;
  if (!reference) {
    return;
  }

  try {
    await verifyAndConfirmPayment(reference);
  } catch (error) {
    console.error(`Webhook processing failed for ${reference}:`, error.message);
  }
}

module.exports = { initialize, getStatus, webhook };
async function verify(req, res) {
  const { reference } = req.params;

  const payment = await prisma.payment.findUnique({ where: { reference } });

  if (!payment || payment.userId !== req.user.id) {
    return res.status(404).json({ error: "Payment not found." });
  }

  try {
    const result = await verifyAndConfirmPayment(reference);
    return res.status(200).json({ payment: result });
  } catch (error) {
    return res.status(422).json({ error: error.message });
  }
}
module.exports = { initialize, getStatus, verify, webhook };