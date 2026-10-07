import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { mockSession } from "./mock-data";

export interface AuthService {
  getSession: () => Promise<typeof mockSession>;
  login: (email: string) => Promise<typeof mockSession>;
  logout: () => Promise<{ success: boolean }>;
  getSummary: () => ModuleSummary;
}

export class MockAuthService implements AuthService {
  async getSession() {
    return mockSession;
  }

  async login(email: string) {
    return {
      ...mockSession,
      user: {
        ...mockSession.user!,
        email
      }
    };
  }

  async logout() {
    return { success: true };
  }

  getSummary(): ModuleSummary {
    return {
      key: "auth",
      title: "Auth",
      description: "Session state and account identity are mocked to support role-based flows later.",
      status: "Mocked",
      metrics: [
        { label: "Session", value: "Authenticated" },
        { label: "Primary user", value: mockSession.user?.name ?? "None" }
      ]
    };
  }
}

export const authService = new MockAuthService();

