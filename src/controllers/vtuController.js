const { z } = require("zod");
const { purchaseAirtime, purchaseData } = require("../services/vtu");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const airtimeSchema = z.object({
  networkCode: z.string().min(1),
  phoneNumber: z.string().min(10).max(15),
  amount: z.number().positive(),
  reference: z.string().min(1).max(191),
});

const dataSchema = z.object({
  networkCode: z.string().min(1),
  phoneNumber: z.string().min(10).max(15),
  dataPlanId: z.number().int().positive(),
  reference: z.string().min(1).max(191),
});

async function buyAirtime(req, res) {
  const parsed = airtimeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  try {
    const transaction = await purchaseAirtime({
      userId: req.user.id,
      ...parsed.data,
    });
    return res.status(201).json({ transaction });
  } catch (error) {
    return res.status(422).json({ error: error.message });
  }
}

async function buyData(req, res) {
  const parsed = dataSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  try {
    const transaction = await purchaseData({
      userId: req.user.id,
      ...parsed.data,
    });
    return res.status(201).json({ transaction });
  } catch (error) {
    return res.status(422).json({ error: error.message });
  }
}

async function getTransactionByReference(req, res) {
  const { reference } = req.params;

  const transaction = await prisma.transaction.findUnique({
    where: { reference },
    include: { walletTransaction: true, network: true, dataPlan: true },
  });

  if (!transaction || transaction.userId !== req.user.id) {
    return res.status(404).json({ error: "Transaction not found." });
  }

  return res.status(200).json({ transaction });
}

module.exports = { buyAirtime, buyData, getTransactionByReference };