import type { AuthSession } from "./types";

export const mockSession: AuthSession = {
  authenticated: true,
  user: {
    id: "user_1",
    name: "Ava Stone",
    email: "ava@tradepilot.dev"
  }
};

