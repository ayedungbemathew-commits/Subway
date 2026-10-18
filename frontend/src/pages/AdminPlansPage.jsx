import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext";

const EMPTY = { networkId: "", name: "", dataAmount: "", validity: "", providerCost: "", sellingPrice: "" };

function money(value) {
  return Number(value).toLocaleString();
}

function check(v) {
  if (!v.name.trim() || !v.dataAmount.trim()) return "Name and data size are required.";
  if (v.providerCost === "" || Number(v.providerCost) < 0) return "Enter the provider cost.";
  if (!(Number(v.sellingPrice) > 0)) return "Enter a selling price above zero.";
  if (Number(v.sellingPrice) < Number(v.providerCost)) return "Selling price is below provider cost.";
  return "";
}

export default function AdminPlansPage() {
  const { user } = useAuth();
  const isAdmin = Boolean(user) && (user.role === "ADMIN" || user.role === "SUPER_ADMIN");

  const [plans, setPlans] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(EMPTY);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [p, n] = await Promise.all([
        client.get("/catalog/admin/data-plans"),
        client.get("/catalog/networks"),
      ]);
      setPlans(p.data.dataPlans);
      setNetworks(n.data.networks);
      setForm((f) => (f.networkId || !n.data.networks.length ? f : { ...f, networkId: String(n.data.networks[0].id) }));
    } catch (err) {
      setError(err.response?.data?.error || "Could not load plans.");
    }
  }

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  async function run(action, okMessage) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      setNotice(okMessage);
      await load();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || "Something went wrong. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addPlan(e) {
    e.preventDefault();
    const problem = check(form);
    if (problem) {
      setNotice("");
      setError(problem);
      return;
    }
    const payload = {
      networkId: Number(form.networkId),
      name: form.name.trim(),
      dataAmount: form.dataAmount.trim(),
      providerCost: Number(form.providerCost),
      sellingPrice: Number(form.sellingPrice),
    };
    if (form.validity.trim()) payload.validity = form.validity.trim();

    const ok = await run(() => client.post("/catalog/data-plans", payload), "Plan added.");
    if (ok) setForm((f) => ({ ...EMPTY, networkId: f.networkId }));
  }

  function startEdit(plan) {
    setError("");
    setNotice("");
    setEditId(plan.id);
    setEdit({
      networkId: String(plan.networkId),
      name: plan.name,
      dataAmount: plan.dataAmount,
      validity: plan.validity || "",
      providerCost: String(plan.providerCost),
      sellingPrice: String(plan.sellingPrice),
    });
  }

  async function saveEdit() {
    const problem = check(edit);
    if (problem) {
      setNotice("");
      setError(problem);
      return;
    }
    const payload = {
      name: edit.name.trim(),
      dataAmount: edit.dataAmount.trim(),
      validity: edit.validity.trim(),
      providerCost: Number(edit.providerCost),
      sellingPrice: Number(edit.sellingPrice),
    };
    const ok = await run(() => client.patch("/catalog/data-plans/" + editId, payload), "Plan updated.");
    if (ok) setEditId(null);
  }

  async function setStatus(plan, status) {
    if (status === "INACTIVE" && !window.confirm("Hide this plan from customers? Past purchases are kept.")) {
      return;
    }
    await run(
      () => client.patch("/catalog/data-plans/" + plan.id, { status }),
      status === "ACTIVE" ? "Plan is visible to customers again." : "Plan hidden from customers."
    );
  }

  return (
    <div className="admin-page">
      <Link to="/" className="back-link">&larr; Back</Link>
      <h1>Data plans</h1>
      <p className="meta-note">
        Hidden plans disappear from the customer Data tab at once. Past purchases are kept.
      </p>

      {error && <p className="error-text">{error}</p>}
      {notice && <p className="success-text">{notice}</p>}

      <h2>Add a plan</h2>
      <form onSubmit={addPlan} className="form-grid">
        <div>
          <label>Network</label>
          <select value={form.networkId} onChange={(e) => setForm({ ...form, networkId: e.target.value })}>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Plan name</label>
          <input type="text" maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label>Data size</label>
          <input type="text" maxLength={50} placeholder="1GB" value={form.dataAmount} onChange={(e) => setForm({ ...form, dataAmount: e.target.value })} />
        </div>
        <div>
          <label>Validity (optional)</label>
          <input type="text" maxLength={50} placeholder="30 days" value={form.validity} onChange={(e) => setForm({ ...form, validity: e.target.value })} />
        </div>
        <div>
          <label>Provider cost (&#8358;)</label>
          <input type="number" min="0" step="0.01" value={form.providerCost} onChange={(e) => setForm({ ...form, providerCost: e.target.value })} />
        </div>
        <div>
          <label>Selling price (&#8358;)</label>
          <input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} />
        </div>
        <button type="submit" disabled={busy}>Add plan</button>
      </form>

      <h2>All plans ({plans.length})</h2>
      {plans.length === 0 && <p className="meta-note">No plans yet.</p>}

      {plans.map((plan) => (
        <div key={plan.id} className={"plan-row" + (plan.status === "ACTIVE" ? "" : " inactive")}>
          {editId === plan.id ? (
            <div className="form-grid">
              <div>
                <label>Plan name</label>
                <input type="text" maxLength={100} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </div>
              <div>
                <label>Data size</label>
                <input type="text" maxLength={50} value={edit.dataAmount} onChange={(e) => setEdit({ ...edit, dataAmount: e.target.value })} />
              </div>
              <div>
                <label>Validity</label>
                <input type="text" maxLength={50} value={edit.validity} onChange={(e) => setEdit({ ...edit, validity: e.target.value })} />
              </div>
              <div />
              <div>
                <label>Provider cost (&#8358;)</label>
                <input type="number" min="0" step="0.01" value={edit.providerCost} onChange={(e) => setEdit({ ...edit, providerCost: e.target.value })} />
              </div>
              <div>
                <label>Selling price (&#8358;)</label>
                <input type="number" min="0" step="0.01" value={edit.sellingPrice} onChange={(e) => setEdit({ ...edit, sellingPrice: e.target.value })} />
              </div>
              <div className="row-actions" style={{ gridColumn: "1 / -1" }}>
                <button type="button" className="small-button" disabled={busy} onClick={saveEdit}>Save</button>
                <button type="button" className="small-button" onClick={() => setEditId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="plan-head">
                <strong>{plan.name}</strong>
                <span className={"badge " + (plan.status === "ACTIVE" ? "on" : "off")}>
                  {plan.status === "ACTIVE" ? "Visible" : "Hidden"}
                </span>
              </div>
              <div className="plan-meta">
                {plan.network ? plan.network.name : "Network " + plan.networkId} &middot; {plan.dataAmount}
                {plan.validity ? " \u00b7 " + plan.validity : ""}
              </div>
              <div className="plan-meta">
                Cost &#8358;{money(plan.providerCost)} &middot; Price &#8358;{money(plan.sellingPrice)} &middot; Margin &#8358;
                {money(Number(plan.sellingPrice) - Number(plan.providerCost))}
              </div>
              <div className="row-actions">
                <button type="button" className="small-button" onClick={() => startEdit(plan)}>Edit</button>
                {plan.status === "ACTIVE" ? (
                  <button type="button" className="small-button" disabled={busy} onClick={() => setStatus(plan, "INACTIVE")}>Hide</button>
                ) : (
                  <button type="button" className="small-button" disabled={busy} onClick={() => setStatus(plan, "ACTIVE")}>Show</button>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
