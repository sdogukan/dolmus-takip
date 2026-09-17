/**
 * Oturum kullanım durumlarının ortak tipleri (T1.4 ADIM 1/2, S1.4).
 *
 * `SessionContext` alan kümesi görev tanımından birebir alınmıştır:
 * "resolveSession(token, clock) → SessionContext { kind: 'vehicle'|
 * 'platform', businessId?, vehicleId?, role: 'owner'|'driver'|'admin'|
 * 'support', credentialId?, platformUserId?, sessionId, csrfToken }".
 */

/** Araç rolü ("owner"/"driver") veya platform rolü ("admin"/"support"). */
export type SessionRole = "owner" | "driver" | "admin" | "support";

export interface SessionContext {
  kind: "vehicle" | "platform";
  /** Yalnız `kind === "vehicle"` iken dolu. */
  businessId?: string;
  /** Yalnız `kind === "vehicle"` iken dolu. */
  vehicleId?: string;
  role: SessionRole;
  /** Yalnız `kind === "vehicle"` iken dolu. */
  credentialId?: string;
  /** Yalnız `kind === "platform"` iken dolu. */
  platformUserId?: string;
  sessionId: string;
  csrfToken: string;
}
