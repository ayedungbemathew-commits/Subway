class ProviderAdapter {
  constructor(config = {}) {
    this.config = config;
  }

  async purchaseAirtime({
    reference,
    networkCode,
    phoneNumber,
    amount,
  }) {
    throw new Error(
      "purchaseAirtime() is not implemented for this provider."
    );
  }

  async purchaseData({
    reference,
    networkCode,
    phoneNumber,
    providerPlanId,
    amount,
  }) {
    throw new Error(
      "purchaseData() is not implemented for this provider."
    );
  }

  async checkTransaction({ reference, transaction }) {
    throw new Error(
      "checkTransaction() is not implemented for this provider."
    );
  }
}

module.exports = ProviderAdapter;
