/**
 * TradePilot API process entry.
 * persistent: optional PostgreSQL via PERSISTENCE_MODE=database
 * mock: default in-memory repositories
 * live trading disabled: this process never enables Kite order placement
 */
import { app } from "./app";
import { env } from "./config/env";

app.listen(env.PORT, () => {
  console.log(`Trade Pilot API listening on port ${env.PORT}`);
});

