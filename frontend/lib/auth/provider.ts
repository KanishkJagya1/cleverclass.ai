/**
 * Auth seam.
 *
 * Out of scope for this phase (Phase 1 §2.1), but every screen is built
 * against this interface so dropping in NextAuth, Clerk, Supabase Auth or a
 * custom JWT service is a single-module change.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

export interface AuthProvider {
  readonly name: string;
  signIn(email: string, password: string): Promise<User>;
  signUp(name: string, email: string, password: string): Promise<User>;
  requestPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  getSession(): Promise<User | null>;
}

const DEMO_USER: User = {
  id: "demo",
  name: "Demo Account",
  email: "demo@kohinoortez.com",
};

export const stubAuthProvider: AuthProvider = {
  name: "stub",
  async signIn(email) {
    await new Promise((r) => setTimeout(r, 600));
    return { ...DEMO_USER, email };
  },
  async signUp(name, email) {
    await new Promise((r) => setTimeout(r, 600));
    return { ...DEMO_USER, name, email };
  },
  async requestPasswordReset() {
    await new Promise((r) => setTimeout(r, 600));
  },
  async signOut() {},
  async getSession() {
    return null;
  },
};

export const auth: AuthProvider = stubAuthProvider;
