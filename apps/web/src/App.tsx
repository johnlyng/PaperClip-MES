import { useEffect, useState } from "react";
import type { WorkOrder, Machine } from "@mes/types";

/**
 * App — Root operator dashboard shell.
 *
 * Renders machine tiles (with data-testid for E2E), a work order table with
 * Start / Complete action buttons, and a completion modal for batch results.
 *
 * data-testid contract (must stay stable for E2E gate):
 *   machine-tile                      — every machine card outer wrapper
 *   machine-tile-{machineId}          — inner div scoped to one machine
 *   machine-status                    — status text inside each tile
 *   wo-start-{workOrderId}            — Start button (visible when status=released)
 *   wo-status-{workOrderId}           — status text cell per row
 *   wo-complete-{workOrderId}         — Complete button (visible when status=in_progress)
 *   completion-modal                  — modal overlay (visible when completing)
 *   actual-quantity-input             — batch actual-quantity input
 *   waste-quantity-input              — batch waste-quantity input
 *   downtime-minutes-input            — batch downtime input
 *   submit-completion-button          — modal submit button
 */
export function App() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  // Modal state
  const [completingWoId, setCompletingWoId] = useState<string | null>(null);
  const [actualQty, setActualQty] = useState("");
  const [wasteQty, setWasteQty] = useState("");
  const [downtimeMin, setDowntimeMin] = useState("");

  useEffect(() => {
    fetch("/api/v1/work-orders")
      .then((r) => r.json())
      .then(setWorkOrders)
      .catch(console.error);

    fetch("/api/v1/machines")
      .then((r) => r.json())
      .then(setMachines)
      .catch(console.error);
  }, []);

  useEffect(() => {
    let retryDelay = 1000;
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(`ws://${window.location.host}/api/v1/ws/telemetry`);

      ws.onopen = () => {
        setWsStatus("connected");
        retryDelay = 1000;
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            machineId?: string;
            status?: string;
          };
          if (msg.type === "machine_status" && msg.machineId && msg.status) {
            setMachines((prev) =>
              prev.map((m) =>
                m.id === msg.machineId ? { ...m, status: msg.status as Machine["status"] } : m
              )
            );
          }
        } catch {
          // non-JSON frames (ping/pong) — ignore
        }
      };
      ws.onclose = () => {
        setWsStatus("disconnected");
        setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60_000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => ws?.close();
  }, []);

  async function handleStart(id: string) {
    try {
      const r = await fetch(`/api/v1/work-orders/${id}/transition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "start" }),
      });
      if (r.ok) {
        const updated = (await r.json()) as WorkOrder;
        setWorkOrders((prev) => prev.map((wo) => (wo.id === id ? updated : wo)));
      }
    } catch (err) {
      console.error("Failed to start work order", err);
    }
  }

  function openCompletionModal(id: string) {
    setCompletingWoId(id);
    setActualQty("");
    setWasteQty("");
    setDowntimeMin("");
  }

  async function handleSubmitCompletion() {
    if (!completingWoId) return;
    try {
      const r = await fetch(`/api/v1/work-orders/${completingWoId}/transition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "complete" }),
      });
      if (r.ok) {
        const updated = (await r.json()) as WorkOrder;
        setWorkOrders((prev) =>
          prev.map((wo) => (wo.id === completingWoId ? updated : wo))
        );
      }
    } catch (err) {
      console.error("Failed to complete work order", err);
    }
    setCompletingWoId(null);
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <header>
        <h1 style={{ margin: 0 }}>MES Operator Dashboard</h1>
        <p style={{ color: wsStatus === "connected" ? "green" : "red" }}>
          Telemetry: {wsStatus}
        </p>
      </header>

      {/* ── Machine tiles ───────────────────────────────────────────────── */}
      <section>
        <h2>Machines ({machines.length})</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
          {machines.map((m) => (
            // outer wrapper — matches [data-testid="machine-tile"]
            <div
              key={m.id}
              data-testid="machine-tile"
              style={{
                border: "1px solid #ccc",
                borderRadius: "4px",
                padding: "1rem",
                minWidth: "180px",
              }}
            >
              {/* inner div — matches [data-testid="machine-tile-{id}"] */}
              <div data-testid={`machine-tile-${m.id}`}>
                <strong style={{ display: "block", marginBottom: "0.25rem" }}>
                  {m.name}
                </strong>
                <span>
                  Status:{" "}
                  <span data-testid="machine-status">{m.status}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Work orders table ────────────────────────────────────────────── */}
      <section style={{ marginTop: "2rem" }}>
        <h2>Work Orders ({workOrders.length})</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {["#", "Title", "Status", "Machine", "Qty", "Actions"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    borderBottom: "1px solid #ccc",
                    padding: "0.5rem",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workOrders.map((wo) => (
              <tr key={wo.id}>
                <td style={{ padding: "0.5rem" }}>{wo.workOrderNumber}</td>
                <td style={{ padding: "0.5rem" }}>{wo.title}</td>
                <td style={{ padding: "0.5rem" }}>
                  <span data-testid={`wo-status-${wo.id}`}>{wo.status}</span>
                </td>
                <td style={{ padding: "0.5rem" }}>{wo.machineId ?? "—"}</td>
                <td style={{ padding: "0.5rem" }}>
                  {wo.quantity} {wo.unit}
                </td>
                <td style={{ padding: "0.5rem" }}>
                  {wo.status === "released" && (
                    <button
                      data-testid={`wo-start-${wo.id}`}
                      onClick={() => handleStart(wo.id)}
                    >
                      Start
                    </button>
                  )}
                  {wo.status === "in_progress" && (
                    <button
                      data-testid={`wo-complete-${wo.id}`}
                      onClick={() => openCompletionModal(wo.id)}
                    >
                      Complete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Completion modal ─────────────────────────────────────────────── */}
      {completingWoId !== null && (
        <div
          data-testid="completion-modal"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "white",
              padding: "2rem",
              borderRadius: "8px",
              minWidth: "320px",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Log Batch Results</h3>

            <label style={{ display: "block", marginBottom: "1rem" }}>
              Actual Quantity
              <input
                data-testid="actual-quantity-input"
                type="number"
                value={actualQty}
                onChange={(e) => setActualQty(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              />
            </label>

            <label style={{ display: "block", marginBottom: "1rem" }}>
              Waste Quantity
              <input
                data-testid="waste-quantity-input"
                type="number"
                value={wasteQty}
                onChange={(e) => setWasteQty(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              />
            </label>

            <label style={{ display: "block", marginBottom: "1rem" }}>
              Downtime (minutes)
              <input
                data-testid="downtime-minutes-input"
                type="number"
                value={downtimeMin}
                onChange={(e) => setDowntimeMin(e.target.value)}
                style={{ display: "block", width: "100%", marginTop: "0.25rem" }}
              />
            </label>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button onClick={() => setCompletingWoId(null)}>Cancel</button>
              <button
                data-testid="submit-completion-button"
                onClick={() => { void handleSubmitCompletion(); }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
