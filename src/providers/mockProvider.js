const ProviderAdapter = require("./providerAdapter");

class MockProvider extends ProviderAdapter {
  constructor(config = {}) {
    super(config);

    this.mode = (config.mode || "SUCCESS").toUpperCase();
  }

  async purchaseAirtime({
    reference,
    networkCode,
    phoneNumber,
    amount,
  }) {
    if (this.mode === "FAILED") {
      return {
        success: false,
        status: "FAILED",
        providerReference: `MOCK-FAILED-${reference}`,
        providerResponse: {
          provider: "MOCK",
          message: "Simulated provider failure.",
        },
        failureReason: "Simulated provider failure.",
      };
    }

    if (this.mode === "PENDING") {
      return {
        success: false,
        status: "PENDING",
        providerReference: `MOCK-PENDING-${reference}`,
        providerResponse: {
          provider: "MOCK",
          message: "Simulated pending provider response.",
        },
      };
    }

    if (this.mode === "ERROR") {
      throw new Error("Simulated provider timeout.");
    }

    return {
      success: true,
      status: "SUCCESS",
      providerReference: `MOCK-${reference}`,
      providerResponse: {
        provider: "MOCK",
        message: "Simulated airtime purchase successful.",
        networkCode,
        phoneNumber,
        amount: String(amount),
      },
      providerCost: amount,
    };
  }

  async purchaseData({
    reference,
    networkCode,
    phoneNumber,
    providerPlanId,
    amount,
  }) {
    if (this.mode === "FAILED") {
      return {
        success: false,
        status: "FAILED",
        providerReference: `MOCK-FAILED-${reference}`,
        providerResponse: {
          provider: "MOCK",
          message: "Simulated data provider failure.",
        },
        failureReason: "Simulated provider failure.",
      };
    }

    if (this.mode === "PENDING") {
      return {
        success: false,
        status: "PENDING",
        providerReference: `MOCK-PENDING-${reference}`,
        providerResponse: {
          provider: "MOCK",
          message: "Simulated data provider response pending.",
        },
      };
    }

    if (this.mode === "ERROR") {
      throw new Error("Simulated provider timeout.");
    }

    return {
      success: true,
      status: "SUCCESS",
      providerReference: `MOCK-${reference}`,
      providerResponse: {
        provider: "MOCK",
        message: "Simulated data purchase successful.",
        networkCode,
        phoneNumber,
        providerPlanId,
        amount: String(amount),
      },
      providerCost: amount,
    };
  }

  async checkTransaction({ reference, transaction }) {
    if (this.mode === "PENDING") {
      return {
        success: false,
        status: "PENDING",
        providerReference: `MOCK-PENDING-${reference}`,
        providerResponse: {
          provider: "MOCK",
          message: "Simulated transaction is still pending.",
        },
      };
    }

    if (this.mode === "FAILED") {
      return {
        success: false,
        status: "FAILED",
        providerReference: `MOCK-FAILED-${reference}`,
        providerResponse: {
          provider: "MOCK",
          message: "Simulated transaction failed.",
        },
        failureReason: "Simulated provider failure.",
      };
    }

    if (this.mode === "ERROR") {
      throw new Error("Simulated provider timeout.");
    }

    return {
      success: true,
      status: "SUCCESS",
      providerReference: `MOCK-${reference}`,
      providerResponse: {
        provider: "MOCK",
        message: "Simulated transaction successful.",
      },
        providerCost: transaction.amount,
    };
  }
}

module.exports = MockProvider;






