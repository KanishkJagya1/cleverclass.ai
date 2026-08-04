/**
 * Customer auth client.
 *
 * Talks to /api/auth/*, which proxies to the FastAPI service and injects the
 * backend key server-side. The session lives in an HttpOnly cookie the browser
 * sends automatically — nothing here reads or stores a token, because anything
 * this module could read, an XSS bug could read too.
 *
 * INDEPENDENT OF THE LMS. Different service, different database, different
 * cookie. The LMS shares a hostname with this site and cookies are scoped by
 * host rather than by port, so the `cc_` prefix on every cookie this project
 * sets is what keeps the two systems from ever seeing each other's sessions.
 *
 * Replaces the Phase-1 stub, which resolved a fake `DEMO_USER` after a 600 ms
 * timeout and reported success for credentials it never checked.
 */

export interface Address {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  marketingOptIn: boolean;
  address: Address;
}

export interface OrderSummary {
  orderNumber: string;
  status: string;
  total: number;
  subtotal: number;
  shipping: number;
  createdAt: string;
  itemCount: number;
  items: { title: string; qty: number; price: number; slug: string }[];
}

export type ProfilePatch = Partial<{
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  marketingOptIn: boolean;
}>;

/** Carries the server's own message so forms can say what actually went wrong
 *  instead of a generic failure. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      // Same origin today, but explicit: a future move of the API to another
      // host would otherwise silently stop sending the session cookie.
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new AuthError("Could not reach the server. Check your connection.", 0);
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // A proxy error page is HTML, not JSON. Falling through to the generic
    // message below beats showing the user a chunk of markup.
  }

  if (!response.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    let message = "Something went wrong. Please try again.";
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail) && detail.length) {
      // FastAPI validation errors are a list of {loc, msg}; showing the first
      // beats rendering "[object Object]".
      const first = detail[0] as { msg?: string };
      if (first?.msg) message = first.msg;
    }
    throw new AuthError(message, response.status);
  }
  return data as T;
}

export interface AuthProvider {
  readonly name: string;
  getSession(): Promise<User | null>;
  signIn(email: string, password: string): Promise<User>;
  signUp(input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    marketingOptIn?: boolean;
  }): Promise<{ user: User | null; verificationRequired: boolean }>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<User>;
  verifyEmail(token: string): Promise<User>;
  resendVerification(): Promise<void>;
  changePassword(current: string | null, next: string): Promise<void>;
  updateProfile(patch: ProfilePatch): Promise<User>;
  orders(): Promise<OrderSummary[]>;
  providers(): Promise<{ google: boolean; emailDelivery: boolean }>;
}

export const apiAuthProvider: AuthProvider = {
  name: "cleverclass",

  async getSession() {
    // 200 with user:null when signed out — an anonymous page load is a normal
    // answer here, not an error in the console or the access log.
    const data = await call<{ user: User | null }>("me");
    return data.user;
  },

  async signIn(email, password) {
    const data = await call<{ user: User }>("login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return data.user;
  },

  async signUp(input) {
    const data = await call<{ user?: User; verificationRequired: boolean }>("signup", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        password: input.password,
        phone: input.phone ?? "",
        marketingOptIn: input.marketingOptIn ?? false,
      }),
    });
    // `user` is absent when that address already had an account. The server
    // deliberately does not say so — it emails the real owner instead — so the
    // UI must handle "signed up but not signed in" as a normal outcome.
    return { user: data.user ?? null, verificationRequired: data.verificationRequired };
  },

  async signOut() {
    await call("logout", { method: "POST" });
  },

  async requestPasswordReset(email) {
    await call("request-reset", { method: "POST", body: JSON.stringify({ email }) });
  },

  async resetPassword(token, password) {
    const data = await call<{ user: User }>("reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
    return data.user;
  },

  async verifyEmail(token) {
    const data = await call<{ user: User }>("verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    return data.user;
  },

  async resendVerification() {
    await call("resend-verification", { method: "POST" });
  },

  async changePassword(current, next) {
    await call("change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
  },

  async updateProfile(patch) {
    const data = await call<{ user: User }>("profile", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    return data.user;
  },

  async orders() {
    const data = await call<{ orders: OrderSummary[] }>("orders");
    return data.orders;
  },

  async providers() {
    try {
      return await call<{ google: boolean; emailDelivery: boolean }>("providers");
    } catch {
      // Never block the email/password form because this probe failed.
      return { google: false, emailDelivery: false };
    }
  },
};

export const auth: AuthProvider = apiAuthProvider;

/** Where "Continue with Google" points. A full navigation, never fetch — the
 *  browser itself has to land on accounts.google.com. */
export const GOOGLE_SIGNIN_URL = "/api/auth/google/start";
