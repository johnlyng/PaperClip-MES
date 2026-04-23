# Work Order & Production Schedule API Contract

**Version:** v1.0  
**Base URL:** `/api/v1`  
**Auth:** JWT (RS256) via `Authorization: Bearer <token>`  
**Format:** All request/response bodies are `application/json`

---

## State Machine

```
draft -> released -> in_progress <-> paused -> completed
  any state ---------------------------------> cancelled
```

| Event | From | To | Allowed Roles |
|-------|------|----|---------------|
| `release` | `draft` | `released` | supervisor, engineer, admin |
| `start` | `released` | `in_progress` | operator, supervisor, engineer, admin |
| `pause` | `in_progress` | `paused` | operator, supervisor, engineer, admin |
| `resume` | `paused` | `in_progress` | operator, supervisor, engineer, admin |
| `complete` | `in_progress` | `completed` | operator, supervisor, engineer, admin |
| `cancel` | any non-terminal | `cancelled` | supervisor, admin |

Terminal states (`completed`, `cancelled`) accept no further transitions.

---

## Work Orders

### `GET /api/v1/work-orders`

List work orders with optional filters and pagination.

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string (enum) | - | Filter by status. Comma-separated for multiple. |
| `machineId` | UUID | - | Filter by assigned machine. |
| `from` | ISO 8601 | - | `scheduledStart` >= this timestamp. |
| `to` | ISO 8601 | - | `scheduledStart` <= this timestamp. |
| `page` | integer | `1` | Page number (1-based). |
| `pageSize` | integer | `20` | Page size; max `100`. |
| `sort` | string | `scheduledStart:asc` | `scheduledStart:asc|desc`, `priority:desc`, `createdAt:desc` |

**Response `200`:**
```json
{
  "data": [WorkOrder],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

---

### `GET /api/v1/work-orders/:id`

Get a single work order by UUID.

**Response `200`:** `WorkOrder`  
**Response `404`:** `{ "statusCode": 404, "error": "Not Found", "message": "Work order not found" }`

---

### `POST /api/v1/work-orders`

Create a new work order. New WOs always start in `draft` status.

**Request body:**
```json
{
  "title": "Produce Widget Alpha - Batch 7",
  "productId": "PROD-WIDGET-ALPHA",
  "quantity": 500,
  "unit": "pcs",
  "scheduledStart": "2026-05-01T06:00:00Z",
  "scheduledEnd": "2026-05-01T14:00:00Z",
  "machineId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "operatorId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "bomId": "BOM-WIDGET-ALPHA-V3",
  "priority": 0,
  "notes": "Rework batch from NCR-2026-042",
  "metadata": {}
}
```

**Required fields:** `title`, `productId`, `quantity`, `unit`, `scheduledStart`, `scheduledEnd`

**Response `201`:** `WorkOrder` (with generated `id`, `workOrderNumber`, `status: "draft"`, timestamps)

**Response `400`:** Validation errors (missing required fields, `scheduledEnd <= scheduledStart`)

---

### `PATCH /api/v1/work-orders/:id`

Update mutable fields. Only allowed in `draft` or `released` status.

**Request body (all optional):**
```json
{
  "title": "Updated title",
  "scheduledStart": "2026-05-02T06:00:00Z",
  "scheduledEnd": "2026-05-02T14:00:00Z",
  "machineId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "operatorId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "priority": 1,
  "notes": "Updated notes"
}
```

**Mutable fields:** `title`, `scheduledStart`, `scheduledEnd`, `machineId`, `operatorId`, `supervisorId`, `priority`, `notes`, `metadata`

**Immutable after creation:** `workOrderNumber`, `productId`, `quantity`, `unit`, `bomId`, `erpReference`

**Response `200`:** Updated `WorkOrder`  
**Response `422`:** `{ "message": "Work order in status 'in_progress' cannot be edited directly. Use a transition event." }`

---

### `POST /api/v1/work-orders/:id/transitions`

Trigger a state machine event. Emits `mes/workorders/{id}/events` MQTT after DB commit.

**Request body:**
```json
{ "event": "start" }
```

Valid events: `release`, `start`, `pause`, `resume`, `complete`, `cancel`

**Response `200`:** Updated `WorkOrder` with new `status`

**Response `422`:** `{ "message": "Invalid work order transition: released -> cancel" }`

> **MQTT constraint (ADR-001 [F2]):** Publish to MQTT AFTER the DB transaction commits. Do not fire-and-forget before commit. If MQTT publish fails, log but do not roll back.

---

### `DELETE /api/v1/work-orders/:id`

Hard delete only permitted for `draft` WOs. All other statuses require the `cancel` transition.

**Response `204`:** No content  
**Response `409`:** `{ "message": "Only draft work orders can be deleted. Use the cancel transition for released or active orders." }`

---

## Production Schedules

### `GET /api/v1/production-schedules`

List schedule slots with optional filters.

| Param | Type | Description |
|-------|------|-------------|
| `workOrderId` | UUID | Filter by work order. |
| `machineId` | UUID | Filter by machine. |
| `status` | string | Filter by status. |
| `from` | ISO 8601 | `scheduledStart` >= this value. |
| `to` | ISO 8601 | `scheduledStart` <= this value. |
| `page`, `pageSize` | integer | Pagination. |

**Response `200`:** `PaginatedResponse<ProductionSchedule>`

---

### `GET /api/v1/production-schedules/:id`

**Response `200`:** `ProductionSchedule`

---

### `POST /api/v1/production-schedules`

Create a schedule slot. Service MUST check for machine overlap before insert.

**Request body:**
```json
{
  "workOrderId": "uuid",
  "machineId": "uuid",
  "scheduledStart": "2026-05-01T06:00:00Z",
  "scheduledEnd": "2026-05-01T14:00:00Z",
  "sequenceNumber": 0,
  "lineId": "line-001",
  "shiftId": "morning",
  "operatorId": "uuid"
}
```

**Required:** `workOrderId`, `machineId`, `scheduledStart`, `scheduledEnd`

**Overlap check (MUST implement in ScheduleService):**
```sql
SELECT id FROM production_schedules
WHERE machine_id = $machineId
  AND status NOT IN ('cancelled', 'completed')
  AND scheduled_start < $newEnd
  AND scheduled_end   > $newStart
LIMIT 1;
```
If any rows returned: respond `409 Conflict` with conflicting schedule ID.

**Response `201`:** `ProductionSchedule`  
**Response `409`:** `{ "message": "Machine schedule conflict", "conflictingScheduleId": "uuid" }`

---

### `PATCH /api/v1/production-schedules/:id`

Update a schedule slot. Re-runs overlap check on time window changes.

**Response `200`:** Updated `ProductionSchedule`

---

### `DELETE /api/v1/production-schedules/:id`

Delete only if status is `draft` or `cancelled`.

**Response `204`:** No content  
**Response `409`:** Cannot delete active/completed schedule

---

## Resource Assignments

### `GET /api/v1/work-orders/:id/resource-assignments`

List all resource assignments for a work order.

**Response `200`:** `ResourceAssignment[]`

---

### `POST /api/v1/work-orders/:id/resource-assignments`

Add a resource to a work order.

**Request body:**
```json
{
  "resourceType": "operator",
  "resourceId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "quantity": 1,
  "unit": "person",
  "scheduledStart": "2026-05-01T06:00:00Z",
  "scheduledEnd": "2026-05-01T14:00:00Z"
}
```

**Required:** `resourceType`, `resourceId`, `quantity`

**Response `201`:** `ResourceAssignment`

---

### `PATCH /api/v1/resource-assignments/:id`

Update assignment quantity, window, or notes.

**Response `200`:** Updated `ResourceAssignment`

---

### `DELETE /api/v1/resource-assignments/:id`

Remove a resource assignment.

**Response `204`:** No content

---

## Shared Type Shapes

```typescript
WorkOrder {
  id: string;                  // UUID
  workOrderNumber: string;     // WO-YYYY-NNNN
  title: string;
  productId: string;
  quantity: number;
  unit: string;
  status: WorkOrderStatus;
  priority: number;
  scheduledStart: string;      // ISO 8601
  scheduledEnd: string;
  actualStart?: string;
  actualEnd?: string;
  machineId?: string;
  operatorId?: string;
  supervisorId?: string;
  bomId?: string;
  erpReference?: string;
  notes?: string;
  metadata: Record<string, unknown>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

ProductionSchedule {
  id: string;
  workOrderId: string;
  machineId: string;
  lineId?: string;
  sequenceNumber: number;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart?: string;
  actualEnd?: string;
  shiftId?: string;
  operatorId?: string;
  status: ProductionScheduleStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

ResourceAssignment {
  id: string;
  workOrderId: string;
  resourceType: 'machine' | 'operator' | 'tool' | 'material';
  resourceId: string;
  quantity: number;
  unit?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## Implementation Notes for Backend Engineer 1

1. **Drizzle schema:** `packages/db/schema/` - import via `@mes/db/schema`
2. **State machine:** Use `WorkOrderStateMachine.apply()` from `packages/domain`. Do not re-implement transition logic in route handlers.
3. **Work order number generation:** Use a DB sequence: `SELECT 'WO-' || TO_CHAR(now(), 'YYYY') || '-' || LPAD(nextval('wo_number_seq')::text, 4, '0')`. Initialize the sequence in the first migration.
4. **`updated_at` trigger:** Required in the initial migration - Drizzle does not maintain this automatically.
5. **MQTT publish:** Wire in `apps/api/src/plugins/mqtt.ts`. Publish AFTER db transaction commits.
6. **Overlap check:** Implement in `apps/api/src/services/ScheduleService.ts` before every insert/update to `production_schedules`. The index `idx_prod_schedules_machine_time` is designed for this query.
7. **Soft delete:** Work orders are never hard-deleted unless in `draft` status. Use `cancel` transition to preserve audit trail.
