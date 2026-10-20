import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";

const NAIRA = String.fromCharCode(8358);

const TABS = [
  { id: "transactions", label: "Transactions" },
  { id: "payments", label: "Payments" },
  { id: "users", label: "Users" },
  { id: "audit", label: "Audit log" },
];

const PATHS = {
  transactions: "/admin/transactions",
  payments: "/admin/payments",
  users: "/admin/users",
  audit: "/admin/audit-log",
};

const KEYS = { transactions: "transactions", payments: "payments", users: "users", audit: "logs" };

const TX_STATUSES = ["PENDING", "PROCESSING", "SUCCESS", "FAILED", "REVERSED"];
const USER_STATUSES = ["ACTIVE", "SUSPENDED", "DISABLED"];
const NO_FILTERS = { q: "", status: "", type: "" };

function naira(value) {
  return NAIRA + Number(value || 0).toLocaleString();
}

function badgeClass(status) {
  if (status === "SUCCESS" || status === "ACTIVE") return "badge on";
  if (["FAILED", "REVERSED", "SUSPENDED", "DISABLED"].includes(status)) return "badge off";
  return "badge";
}

function when(value) {
  return value ? new Date(value).toLocaleString() : "";
}

export default function AdminPage() {
  const { user } = useAuth();
  const isAdmin = Boolean(user) && (user.role === "ADMIN" || user.role === "SUPER_ADMIN");
  const isSuper = Boolean(user) && user.role === "SUPER_ADMIN";

  const [tab, setTab] = useState("transactions");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(NO_FILTERS);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;

    const params = { page, pageSize: 20 };
    if (tab === "transactions" || tab === "users") {
      if (filters.q) params.q = filters.q;
      if (filters.status) params.status = filters.status;
    }
    if (tab === "transactions" && filters.type) params.type = filters.type;

    setLoading(true);
    setError("");
    client
      .get(PATHS[tab], { params })
      .then((res) => {
        if (cancelled) return;
        setRows(res.data[KEYS[tab]] || []);
        setPagination(res.data.pagination || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setPagination(null);
        setError(err.response?.data?.error || "Could not load this list.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, tab, page, filters, reloadKey]);

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  function switchTab(id) {
    setTab(id);
    setPage(1);
    setDraft(NO_FILTERS);
    setFilters(NO_FILTERS);
    setRows([]);
    setPagination(null);
    setNotice("");
    setError("");
    setAdjust(null);
  }

  function applyFilters(e) {
    e.preventDefault();
    setPage(1);
    setFilters({ ...draft });
  }

  // Same rule the server enforces: never yourself, and only a super admin touches admin accounts.
  function canManage(u) {
    return u.id !== user.id && (u.role === "USER" || isSuper);
  }

  async function setUserStatus(u, status) {
    const verb = status === "ACTIVE" ? "Reinstate" : "Suspend";
    if (!window.confirm(verb + " " + u.email + "?")) return;

    setBusyId(u.id);
    setError("");
    setNotice("");
    try {
      await client.patch("/admin/users/" + u.id + "/status", { status });
      setNotice(u.email + (status === "ACTIVE" ? " reinstated." : " suspended."));
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function submitAdjust(u) {
    const amount = Number(adjust.amount);
    const reason = adjust.reason.trim();
    if (!(amount > 0)) {
      setNotice("");
      setError("Enter an amount above zero.");
      return;
    }
    if (reason.length < 3) {
      setNotice("");
      setError("Give a reason of at least 3 characters.");
      return;
    }

    const verb = adjust.type === "CREDIT" ? "Credit" : "Debit";
    const prep = adjust.type === "CREDIT" ? " to " : " from ";
    if (!window.confirm(verb + " " + naira(amount) + prep + u.email + ". Reason: " + reason)) return;

    setBusyId(u.id);
    setError("");
    setNotice("");
    try {
      await client.post("/admin/users/" + u.id + "/wallet/adjust", { amount, type: adjust.type, reason });
      setNotice(verb + " of " + naira(amount) + " applied to " + u.email + ".");
      setAdjust(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <Link to="/" className="back-link">&larr; Back</Link>
      <h1>Admin</h1>
      <p className="meta-note">
        <Link to="/admin/plans" className="back-link">Manage data plans</Link>
      </p>

      <div className="tab-buttons admin-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? "active" : ""} onClick={() => switchTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {(tab === "transactions" || tab === "users") && (
        <form onSubmit={applyFilters} className="filter-row">
          <div>
            <label>{tab === "users" ? "Search name, email or phone" : "Search reference, phone or email"}</label>
            <input type="text" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
          </div>
          <div>
            <label>Status</label>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">All</option>
              {(tab === "users" ? USER_STATUSES : TX_STATUSES).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {tab === "transactions" && (
            <div>
              <label>Type</label>
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                <option value="">All</option>
                <option value="AIRTIME">Airtime</option>
                <option value="DATA">Data</option>
              </select>
            </div>
          )}
          <button type="submit" disabled={loading} style={{ width: "auto", padding: "10px 18px" }}>Search</button>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="success-text">{notice}</p>}
      {loading && <p className="meta-note">Loading...</p>}
      {!loading && !error && rows.length === 0 && <p className="meta-note">Nothing to show.</p>}
      {pagination && rows.length > 0 && <p className="meta-note">{pagination.total} total</p>}

      {tab === "transactions" &&
        rows.map((t) => (
          <div key={t.id} className="plan-row">
            <div className="plan-head">
              <strong>{t.type} {naira(t.amount)}</strong>
              <span className={badgeClass(t.status)}>{t.status}</span>
            </div>
            <div className="plan-meta">{t.phoneNumber} &middot; {t.user ? t.user.email : "user " + t.userId}</div>
            <div className="plan-meta">{when(t.createdAt)}</div>
            <div className="plan-meta ref">{t.reference}</div>
            {t.failureReason && <div className="error-text" style={{ fontSize: 13 }}>{t.failureReason}</div>}
            {t.status === "PENDING" && <div style={{ marginTop: 8 }}><button type="button" className="small-button" disabled={busyId === "tx-" + t.id} onClick={() => failPendingTransaction(t, client, setBusyId, setError, setNotice, setReloadKey)}>Mark as failed</button></div>}
          </div>
        ))}

      {tab === "payments" &&
        rows.map((x) => (
          <div key={x.id} className="plan-row">
            <div className="plan-head">
              <strong>{naira(x.amount)}</strong>
              <span className={badgeClass(x.status)}>{x.status}</span>
            </div>
            <div className="plan-meta">{x.user ? x.user.email : "user " + x.userId}</div>
            <div className="plan-meta">{when(x.createdAt)}</div>
            <div className="plan-meta ref">{x.reference}</div>
          </div>
        ))}

      {tab === "users" &&
        rows.map((u) => (
          <div key={u.id} className={"plan-row" + (u.status === "ACTIVE" ? "" : " inactive")}>
            <div className="plan-head">
              <strong>{u.name || u.email}</strong>
              <span className={badgeClass(u.status)}>{u.status}</span>
            </div>
            <div className="plan-meta">{u.email}{u.phone ? " | " + u.phone : ""}</div>
            <div className="plan-meta">
              {u.role} &middot; Wallet {naira(u.wallet ? u.wallet.balance : 0)} &middot; Joined {when(u.createdAt)}
            </div>

            {canManage(u) && (
              <div className="row-actions">
                {u.status === "ACTIVE" ? (
                  <button type="button" className="small-button" disabled={busyId === u.id} onClick={() => setUserStatus(u, "SUSPENDED")}>Suspend</button>
                ) : (
                  <button type="button" className="small-button" disabled={busyId === u.id} onClick={() => setUserStatus(u, "ACTIVE")}>Reinstate</button>
                )}
                {isSuper && (
                  <button
                    type="button"
                    className="small-button"
                    onClick={() => setAdjust(adjust && adjust.userId === u.id ? null : { userId: u.id, type: "CREDIT", amount: "", reason: "" })}
                  >
                    Adjust wallet
                  </button>
                )}
              </div>
            )}

            {adjust && adjust.userId === u.id && (
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div>
                  <label>Type</label>
                  <select value={adjust.type} onChange={(e) => setAdjust({ ...adjust, type: e.target.value })}>
                    <option value="CREDIT">Credit (add money)</option>
                    <option value="DEBIT">Debit (remove money)</option>
                  </select>
                </div>
                <div>
                  <label>Amount ({NAIRA})</label>
                  <input type="number" min="0" step="0.01" value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Reason (kept in the audit log)</label>
                  <input type="text" maxLength={150} value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
                </div>
                <div className="row-actions" style={{ gridColumn: "1 / -1" }}>
                  <button type="button" className="small-button" disabled={busyId === u.id} onClick={() => submitAdjust(u)}>Apply</button>
                  <button type="button" className="small-button" onClick={() => setAdjust(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        ))}

      {tab === "audit" &&
        rows.map((l) => (
          <div key={l.id} className="plan-row">
            <div className="plan-head">
              <strong>{l.action}</strong>
              <span className="meta-note">{when(l.createdAt)}</span>
            </div>
            <div className="plan-meta">
              {l.actor ? l.actor.email : "user " + l.actorId} &middot; {l.entity} #{l.entityId}{auditDetail(l) && <div style={{ marginTop: 4 }}>{auditDetail(l)}</div>}
            </div>
          </div>
        ))}

      {pagination && pagination.totalPages > 1 && (
        <div className="pager">
          <button type="button" className="small-button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="meta-note">Page {pagination.page} of {pagination.totalPages}</span>
          <button type="button" className="small-button" disabled={page >= pagination.totalPages || loading} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function auditDetail(l) { var parse = function (v) { if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return null; } } return v || null; }; var o = parse(l.oldValue), n = parse(l.newValue); if (n && n.type && n.amount !== undefined) { return String(n.type).toUpperCase() + " \u20A6" + Number(n.amount).toLocaleString() + (n.reason ? " \u00B7 " + n.reason : "") + (n.balanceAfter !== undefined ? " \u00B7 balance \u20A6" + Number(n.balanceAfter).toLocaleString() : ""); } if (n && n.status) { return (o && o.status ? o.status : "?") + " \u2192 " + n.status + (n.reason ? " \u00B7 " + n.reason : ""); } if (n && n.role) { return (o && o.role ? o.role : "?") + " \u2192 " + n.role; } return ""; }

async function failPendingTransaction(t, client, setBusyId, setError, setNotice, setReloadKey) {
  var reason = window.prompt("Why are you marking this transaction as failed? (at least 3 characters)");
  if (reason === null) return;
  reason = reason.trim();
  if (reason.length < 3) { setNotice(""); setError("Give a reason of at least 3 characters."); return; }
  if (!window.confirm("Mark " + t.type + " \u20A6" + Number(t.amount).toLocaleString() + " for " + t.phoneNumber + " as FAILED?\nReason: " + reason)) return;
  setBusyId("tx-" + t.id); setError(""); setNotice("");
  try {
    await client.patch("/admin/transactions/" + t.id + "/fail", { reason: reason });
    setNotice("Transaction marked as failed.");
    setReloadKey(function (k) { return k + 1; });
  } catch (err) {
    setError((err.response && err.response.data && err.response.data.error) || "Something went wrong. Please try again.");
  } finally {
    setBusyId(null);
  }
}
