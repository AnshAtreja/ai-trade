import { create } from "zustand";

interface TradingState {
  selectedSymbol: string;
  killSwitchArmed: boolean;
  setSelectedSymbol: (symbol: string) => void;
  setKillSwitchArmed: (armed: boolean) => void;
  toggleKillSwitch: () => void;
}

export const useTradingStore = create<TradingState>((set) => ({
  selectedSymbol: "NSE:RELIANCE",
  killSwitchArmed: true,
  setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol }),
  setKillSwitchArmed: (killSwitchArmed) => set({ killSwitchArmed }),
  toggleKillSwitch: () => set((state) => ({ killSwitchArmed: !state.killSwitchArmed }))
}));
