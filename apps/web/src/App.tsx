import { useEffect, useState } from "react";
import type { WorkOrder, Machine } from "@mes/types";

/**
 * App — Root operator dashboard shell.
 *
 * Scaffold: renders a status header and basic work order list.
 * UI components (shadcn/ui), routing (React Router), and OEE charts (Recharts)
 * are wired in during GST Phase 2.
 */
export function App() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  useEffect(() => {
    // Fetch initial data
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
    // Real-time telemetry WebSocket with exponential backoff reconnect
    let retryDelay = 1000;
    let ws: WebSocket;

    function connect() {
      ws = new WebSocket(`ws://${window.location.host}/api/v1/ws/telemetry`);

      ws.onopen = () => {
        setWsStatus("connected");
        retryDelay = 1000;
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

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <header>
        <h1 style={{ margin: 0 }}>MES Operator Dashboard</h1>
        <p style={{ color: wsStatus === "connected" ? "green" : "red" }}>
          Telemetry: {wsStatus}
        </p>
      </header>

      <section>
        <h2>Machines ({machines.length})</h2>
        <ul>
          {machines.map((m) => (
            <li key={m.id}>
              {m.name} — <strong>{m.status}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Work Orders ({workOrders.length})</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {["#", "Title", "Status", "Machine", "Qty"].map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
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
                <td style={{ padding: "0.5rem" }}>{wo.status}</td>
                <td style={{ padding: "0.5rem" }}>{wo.machineId ?? "—"}</td>
                <td style={{ padding: "0.5rem" }}>{wo.quantity} {wo.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
