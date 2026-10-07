import { money } from "../../../common/utils/trading-date";
import { KiteAccountError } from "./errors";
import type {
  BrokerAccountHolding,
  BrokerAccountOrder,
  BrokerAccountPosition,
  BrokerAccountProfile,
  BrokerAccountSource,
  BrokerFunds,
  BrokerMarginSegment
} from "./types";

function num(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KiteAccountError("KITE_MALFORMED_RESPONSE", "Kite returned a malformed object.");
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function mapKiteProfile(raw: unknown, source: BrokerAccountSource): BrokerAccountProfile {
  const data = asRecord(raw);
  const userId = str(data.user_id);

  if (!userId) {
    throw new KiteAccountError("KITE_MALFORMED_RESPONSE", "Kite profile is missing user_id.");
  }

  return {
    source,
    userId,
    userName: str(data.user_name) ?? userId,
    userShortName: str(data.user_shortname),
    email: str(data.email),
    broker: str(data.broker) ?? "ZERODHA",
    userType: str(data.user_type),
    products: asArray(data.products).filter((item): item is string => typeof item === "string"),
    exchanges: asArray(data.exchanges).filter((item): item is string => typeof item === "string"),
    orderTypes: asArray(data.order_types).filter((item): item is string => typeof item === "string")
  };
}

function mapMarginBucket(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return {
      adhocMargin: null,
      cash: null,
      openingBalance: null,
      liveBalance: null,
      collateral: null,
      intradayPayin: null
    };
  }

  const data = raw as Record<string, unknown>;

  return {
    adhocMargin: num(data.adhoc_margin),
    cash: num(data.cash),
    openingBalance: num(data.opening_balance),
    liveBalance: num(data.live_balance),
    collateral: num(data.collateral),
    intradayPayin: num(data.intraday_payin)
  };
}

function mapUtilisedBucket(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return {
      debits: null,
      exposure: null,
      m2mRealised: null,
      m2mUnrealised: null,
      optionPremium: null,
      payout: null,
      span: null,
      holdingSales: null,
      turnover: null,
      liquidCollateral: null,
      stockCollateral: null,
      delivery: null
    };
  }

  const data = raw as Record<string, unknown>;

  return {
    debits: num(data.debits),
    exposure: num(data.exposure),
    m2mRealised: num(data.m2m_realised),
    m2mUnrealised: num(data.m2m_unrealised),
    optionPremium: num(data.option_premium),
    payout: num(data.payout),
    span: num(data.span),
    holdingSales: num(data.holding_sales),
    turnover: num(data.turnover),
    liquidCollateral: num(data.liquid_collateral),
    stockCollateral: num(data.stock_collateral),
    delivery: num(data.delivery)
  };
}

function mapMarginSegment(raw: unknown): BrokerMarginSegment | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as Record<string, unknown>;

  return {
    enabled: typeof data.enabled === "boolean" ? data.enabled : null,
    net: num(data.net),
    available: mapMarginBucket(data.available),
    utilised: mapUtilisedBucket(data.utilised)
  };
}

export function mapKiteFunds(raw: unknown, source: BrokerAccountSource, capturedAt = new Date().toISOString()): BrokerFunds {
  const data = asRecord(raw);

  return {
    source,
    equity: mapMarginSegment(data.equity),
    commodity: mapMarginSegment(data.commodity),
    capturedAt
  };
}

function mapPosition(raw: unknown, book: BrokerAccountPosition["book"]): BrokerAccountPosition | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const data = raw as Record<string, unknown>;
  const tradingSymbol = str(data.tradingsymbol);

  if (!tradingSymbol) {
    return null;
  }

  return {
    book,
    exchange: str(data.exchange) ?? "",
    tradingSymbol,
    product: str(data.product) ?? "",
    quantity: num(data.quantity) ?? 0,
    overnightQuantity: num(data.overnight_quantity) ?? 0,
    buyQuantity: num(data.buy_quantity) ?? 0,
    sellQuantity: num(data.sell_quantity) ?? 0,
    buyAverage: num(data.buy_price),
    sellAverage: num(data.sell_price),
    averagePrice: num(data.average_price),
    lastPrice: num(data.last_price),
    realisedPnl: num(data.realised),
    unrealisedPnl: num(data.unrealised),
    pnl: num(data.pnl),
    multiplier: num(data.multiplier),
    value: num(data.value)
  };
}

export function mapKitePositions(raw: unknown): BrokerAccountPosition[] {
  const data = asRecord(raw);
  const net = asArray(data.net).map((item) => mapPosition(item, "NET")).filter((item): item is BrokerAccountPosition => Boolean(item));
  const day = asArray(data.day).map((item) => mapPosition(item, "DAY")).filter((item): item is BrokerAccountPosition => Boolean(item));

  return [...net, ...day];
}

export function mapKiteOrders(raw: unknown): BrokerAccountOrder[] {
  return asArray(raw)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const data = item as Record<string, unknown>;
      const orderId = str(data.order_id);

      if (!orderId) {
        return null;
      }

      return {
        orderId,
        exchange: str(data.exchange) ?? "",
        tradingSymbol: str(data.tradingsymbol) ?? "",
        transactionType: str(data.transaction_type) ?? "",
        quantity: num(data.quantity) ?? 0,
        filledQuantity: num(data.filled_quantity) ?? 0,
        pendingQuantity: num(data.pending_quantity) ?? 0,
        price: num(data.price),
        averagePrice: num(data.average_price),
        triggerPrice: num(data.trigger_price),
        orderType: str(data.order_type) ?? "",
        product: str(data.product) ?? "",
        validity: str(data.validity),
        status: str(data.status) ?? "",
        statusMessage: str(data.status_message),
        orderTimestamp: str(data.order_timestamp),
        exchangeTimestamp: str(data.exchange_timestamp)
      } satisfies BrokerAccountOrder;
    })
    .filter((item): item is BrokerAccountOrder => Boolean(item));
}

export function mapKiteHoldings(raw: unknown): BrokerAccountHolding[] {
  return asArray(raw)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const data = item as Record<string, unknown>;
      const tradingSymbol = str(data.tradingsymbol);

      if (!tradingSymbol) {
        return null;
      }

      return {
        tradingSymbol,
        exchange: str(data.exchange) ?? "",
        quantity: num(data.quantity) ?? 0,
        averagePrice: num(data.average_price),
        lastPrice: num(data.last_price),
        pnl: num(data.pnl),
        authorisedQuantity: num(data.authorised_quantity),
        product: str(data.product)
      } satisfies BrokerAccountHolding;
    })
    .filter((item): item is BrokerAccountHolding => Boolean(item));
}

export function sumPnl(positions: BrokerAccountPosition[]) {
  const net = positions.filter((position) => position.book === "NET");
  const day = positions.filter((position) => position.book === "DAY");

  return {
    realised: money(net.reduce((total, position) => total + (position.realisedPnl ?? 0), 0)),
    unrealised: money(net.reduce((total, position) => total + (position.unrealisedPnl ?? 0), 0)),
    day: money(
      (day.length > 0 ? day : net).reduce((total, position) => total + (position.pnl ?? 0), 0)
    )
  };
}
