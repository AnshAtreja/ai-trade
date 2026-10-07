# Safety rules

TradePilot is built **paper-first**. Live order placement stays disabled until Phases 20–21 deliberately unlock it.

## Hard rules

1. **`KiteBrokerAdapter` must not place, modify, or cancel live orders** until Phase 20+ explicitly enables a gated path. Current adapter throws on live order methods.
2. **UI must always show live trading as disabled** while that guard exists.
3. **Dashboard kill switch** is a product control for future live paths; it does not replace the broker adapter guard.
4. **LLM / MCP reasoning (Phase 17)** may explain and propose only. Flow is always:

   ```text
   LLM -> proposed explanation/proposal -> Unified Decision Engine -> Risk Engine -> Order Manager
   ```

5. **Shadow mode (Phase 19)** runs the full decision path with `Kite order = NEVER`.
6. **SEBI / Kite retail-algo requirements** are re-verified at Phase 20 — do not assume today's rules forever.

## Modes vs execution

| Snapshot / UI label | Execution allowed? |
| --- | --- |
| Paper | Simulated only |
| Kite / LIVE account observation | No (read-only) |
| Shadow | No broker orders |
| Controlled live | Only after Phase 20–21 + kill switch + risk |

## Incident controls (planned Phase 20)

- Backend kill switch
- Daily shutdown / square-off window
- Emergency flatten
- Broker disconnect recovery
- Order and position reconciliation
- Idempotent order submission

Until those exist, treat any “live” wording as **observation of broker state**, not execution.
