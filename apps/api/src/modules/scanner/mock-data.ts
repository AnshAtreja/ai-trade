import type { ScanCandidate } from './types';

export const mockScans: ScanCandidate[] = [
  {
    symbol: 'META',
    setup: 'Opening range breakout',
    score: 87,
    timeframe: '15m',
  },
  {
    symbol: 'AMD',
    setup: 'Volume expansion pullback',
    score: 79,
    timeframe: '1h',
  },
  { symbol: 'MSFT', setup: 'Trend continuation', score: 76, timeframe: '4h' },
];

export const mockIntradayInstruments = [
  {
    symbol: 'NVDA',
    currentPrice: 1048.12,
    openPrice: 1022.4,
    previousClose: 1001.2,
    currentVolume: 48200000,
    averageVolume: 26500000,
    dayHigh: 1050,
    dayLow: 1018.2,
    vwap: 1037.45,
    previousHigh: 1039.5,
    previousLow: 995.8,
  },
  {
    symbol: 'TSLA',
    currentPrice: 176.1,
    openPrice: 181.2,
    previousClose: 185.4,
    currentVolume: 96800000,
    averageVolume: 70200000,
    dayHigh: 182.6,
    dayLow: 175.9,
    vwap: 178.22,
    previousHigh: 188.75,
    previousLow: 177.4,
  },
  {
    symbol: 'AAPL',
    currentPrice: 212.33,
    openPrice: 210.2,
    previousClose: 209.7,
    currentVolume: 28800000,
    averageVolume: 54100000,
    dayHigh: 213.1,
    dayLow: 209.8,
    vwap: 211.68,
    previousHigh: 214.2,
    previousLow: 207.5,
  },
];
