import type { NormalizedInstrument } from "./instrument-types";

const CAPTURED = "2026-09-10T12:00:00.000Z";

export const MOCK_INSTRUMENTS: NormalizedInstrument[] = [
  {
    tradingSymbol: "RELIANCE",
    exchange: "NSE",
    name: "Reliance Industries Limited",
    instrumentToken: "2885",
    exchangeToken: "738",
    segment: "NSE",
    instrumentType: "EQ",
    expiry: null,
    strike: null,
    tickSize: 0.05,
    lotSize: 1,
    isActive: true
  },
  {
    tradingSymbol: "INFY",
    exchange: "NSE",
    name: "Infosys Limited",
    instrumentToken: "408065",
    exchangeToken: "1594",
    segment: "NSE",
    instrumentType: "EQ",
    expiry: null,
    strike: null,
    tickSize: 0.05,
    lotSize: 1,
    isActive: true
  },
  {
    tradingSymbol: "TCS",
    exchange: "NSE",
    name: "Tata Consultancy Services Limited",
    instrumentToken: "2953217",
    exchangeToken: "11536",
    segment: "NSE",
    instrumentType: "EQ",
    expiry: null,
    strike: null,
    tickSize: 0.05,
    lotSize: 1,
    isActive: true
  },
  {
    tradingSymbol: "HDFCBANK",
    exchange: "BSE",
    name: "HDFC Bank Limited",
    instrumentToken: "1270529",
    exchangeToken: "500180",
    segment: "BSE",
    instrumentType: "EQ",
    expiry: null,
    strike: null,
    tickSize: 0.05,
    lotSize: 1,
    isActive: true
  },
  {
    tradingSymbol: "NIFTYBEES",
    exchange: "NSE",
    name: "Nippon India ETF Nifty BeES",
    instrumentToken: "2707457",
    exchangeToken: "10576",
    segment: "NSE",
    instrumentType: "EQ",
    expiry: null,
    strike: null,
    tickSize: 0.01,
    lotSize: 1,
    isActive: true
  },
  {
    tradingSymbol: "RELIANCE25SEP2500CE",
    exchange: "NFO",
    name: "RELIANCE",
    instrumentToken: "123456",
    exchangeToken: "999",
    segment: "NFO-OPT",
    instrumentType: "CE",
    expiry: new Date("2026-09-24T00:00:00+05:30"),
    strike: 2500,
    tickSize: 0.05,
    lotSize: 250,
    isActive: true
  },
  {
    tradingSymbol: "NIFTY25SEPFUT",
    exchange: "NFO",
    name: "NIFTY",
    instrumentToken: "654321",
    exchangeToken: "998",
    segment: "NFO-FUT",
    instrumentType: "FUT",
    expiry: new Date("2026-09-24T00:00:00+05:30"),
    strike: null,
    tickSize: 0.05,
    lotSize: 25,
    isActive: true
  },
  {
    tradingSymbol: "USDINR",
    exchange: "CDS",
    name: "USDINR",
    instrumentToken: "111",
    exchangeToken: "111",
    segment: "CDS-FUT",
    instrumentType: "FUT",
    expiry: new Date("2026-09-29T00:00:00+05:30"),
    strike: null,
    tickSize: 0.0025,
    lotSize: 1,
    isActive: true
  },
  {
    tradingSymbol: "CRUDEOIL",
    exchange: "MCX",
    name: "CRUDE OIL",
    instrumentToken: "222",
    exchangeToken: "222",
    segment: "MCX-FUT",
    instrumentType: "FUT",
    expiry: new Date("2026-09-18T00:00:00+05:30"),
    strike: null,
    tickSize: 1,
    lotSize: 1,
    isActive: true
  },
  {
    tradingSymbol: "OLDCO",
    exchange: "NSE",
    name: "Delisted Example",
    instrumentToken: "1",
    exchangeToken: "1",
    segment: "NSE",
    instrumentType: "EQ",
    expiry: null,
    strike: null,
    tickSize: 0.05,
    lotSize: 1,
    isActive: false
  }
];

export const MOCK_QUOTE_CAPTURED_AT = CAPTURED;
