export const ADMIN_EMAIL = "ferryfebrian.lim@gmail.com";

export function isAdminEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase() === ADMIN_EMAIL);
}

export const DEFAULT_DEMO_VIDEO = {
  id: "w6199XN1Gyk",
  title: "Demo Listening Practice",
  channel: "YouTube",
  durationSec: null as number | null,
};
