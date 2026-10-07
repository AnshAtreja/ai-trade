export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthSession {
  authenticated: boolean;
  user: SessionUser | null;
}

