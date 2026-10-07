/**
 * Broker credential storage.
 *
 * persistent: BrokerConnection.credentialRef is only an opaque pointer
 * mock: unused in fixture workflows
 * broker integration: Kite access tokens live here, encrypted at rest
 * paper trading: credentials may be used for market data while fills stay simulated
 * live trading disabled: never persist raw tokens in PostgreSQL and never use them to place live orders
 */
export interface BrokerCredentials {
  provider: string;
  payload: Record<string, unknown>;
}

export interface BrokerCredentialStore {
  save(ref: string, credentials: BrokerCredentials): Promise<void>;
  load(ref: string): Promise<BrokerCredentials | null>;
  delete(ref: string): Promise<void>;
}
