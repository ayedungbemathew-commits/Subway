const ProviderAdapter = require("./providerAdapter");

const AUTH_URL = "https://vtu.ng/wp-json/jwt-auth/v1/token";
const API_BASE = "https://vtu.ng/wp-json/api/v2/";

// VTU.ng order statuses -> our internal status vocabulary.
const STATUS_MAP = {
  "completed-api": "SUCCESS",
  "processing-api": "PENDING",
  "queued-api": "PENDING",
  "initiated-api": "PENDING",
  "pending": "PENDING",
  "refunded": "FAILED",
  "cancelled": "FAILED",
  "failed": "FAILED",
  "on-hold": "PENDING",
};

class VtuNgProvider extends ProviderAdapter {
  constructor(config = {}) {
    super(config);
    this.username = config.username || process.env.VTU_NG_USERNAME;
    this.password = config.password || process.env.VTU_NG_PASSWORD;
    this.token = null;
    this.tokenObtainedAt = null;
  }

  async getToken(forceRefresh = false) {
    const tokenAgeMs = this.tokenObtainedAt ? Date.now() - this.tokenObtainedAt : Infinity;
    const sixDaysMs = 6 * 24 * 60 * 60 * 1000;

    if (!forceRefresh && this.token && tokenAgeMs < sixDaysMs) {
      return this.token;
    }

    const response = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });

    const data = await response.json();

    if (!response.ok || !data.token) {
      throw new Error(
        `VTU.ng authentication failed: ${data.message || response.status}`
      );
    }

    this.token = data.token;
    this.tokenObtainedAt = Date.now();
    return this.token;
  }

  async request(method, path, body = null, { retrying = false } = {}) {
    const token = await this.getToken();

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    // Token may have been invalidated; refresh once and retry.
    if (response.status === 403 && !retrying) {
      await this.getToken(true);
      return this.request(method, path, body, { retrying: true });
    }

    return { httpStatus: response.status, ok: response.ok, data };
  }

  async checkBalance() {
    const { ok, data } = await this.request("GET", "balance");
    if (!ok) {
      throw new Error(`VTU.ng balance check failed: ${data.message || "unknown error"}`);
    }
    return data.data; // { balance, currency }
  }

  _mapOrderToResult(orderData, fallbackReference) {
    const status = STATUS_MAP[orderData.status] || "PENDING";
    const result = {
      success: status === "SUCCESS",
      status,
      providerReference: String(orderData.order_id || fallbackReference),
      providerResponse: orderData,
    };
    if (status === "FAILED") {
      result.failureReason = `VTU.ng order ${orderData.status}.`;
    }
    if (status === "SUCCESS") {
      result.providerCost = Number(orderData.amount_charged || orderData.amount);
    }
    return result;
  }

  async purchaseAirtime({ reference, networkCode, phoneNumber, amount }) {
    const { ok, data, httpStatus } = await this.request("POST", "airtime", {
      request_id: reference,
      phone: phoneNumber,
      service_id: networkCode.toLowerCase(),
      amount,
    });

    if (!ok) {
      // Business-logic failure (bad params, insufficient funds, etc.) — not a network error.
      if (httpStatus >= 400 && httpStatus < 500) {
        return {
          success: false,
          status: "FAILED",
          providerReference: `VTUNG-ERROR-${reference}`,
          providerResponse: data,
          failureReason: data.message || data.code || "VTU.ng rejected the request.",
        };
      }
      throw new Error(`VTU.ng airtime purchase error: ${data.message || httpStatus}`);
    }

    return this._mapOrderToResult(data.data, reference);
  }

  async purchaseData({ reference, networkCode, phoneNumber, providerPlanId, amount }) {
    const { ok, data, httpStatus } = await this.request("POST", "data", {
      request_id: reference,
      phone: phoneNumber,
      service_id: networkCode.toLowerCase(),
      variation_id: providerPlanId,
    });

    if (!ok) {
      if (httpStatus >= 400 && httpStatus < 500) {
        return {
          success: false,
          status: "FAILED",
          providerReference: `VTUNG-ERROR-${reference}`,
          providerResponse: data,
          failureReason: data.message || data.code || "VTU.ng rejected the request.",
        };
      }
      throw new Error(`VTU.ng data purchase error: ${data.message || httpStatus}`);
    }

    return this._mapOrderToResult(data.data, reference);
  }

  async checkTransaction({ reference }) {
    const { ok, data, httpStatus } = await this.request("POST", "requery", {
      request_id: reference,
    });

    if (!ok) {
      if (httpStatus === 404) {
        return {
          success: false,
          status: "FAILED",
          providerReference: `VTUNG-NOTFOUND-${reference}`,
          providerResponse: data,
          failureReason: "Order not found at VTU.ng.",
        };
      }
      throw new Error(`VTU.ng requery error: ${data.message || httpStatus}`);
    }

    return this._mapOrderToResult(data.data, reference);
  }
}

module.exports = VtuNgProvider;