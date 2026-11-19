/**
 * Money (Milestone 8) — integer minor units only.
 *
 * Prices are stored as INTEGER kobo/cents and never as float, the same
 * rule as LIFEOS money handling: a float price is a rounding bug waiting
 * to happen. All formatting goes through here so every surface (admin,
 * shop pages, order emails, agent reports) shows the same number.
 */
import { badRequest } from "../../kernel/errors";

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: "₦",
  USD: "$",
  EUR: "€",
  GBP: "£",
  GHS: "₵",
  KES: "KSh",
  ZAR: "R",
};

/** A 3-letter uppercase currency code (NGN, USD, …). */
export function requireCurrency(value: unknown, field = "currency"): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) {
    throw badRequest(`Field "${field}" must be a 3-letter currency code (e.g. NGN).`);
  }
  return value.trim().toUpperCase();
}

/** An integer amount in minor units (kobo/cents). Floats are rejected. */
export function requireMinorUnits(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`Field "${field}" must be an integer amount in minor units (kobo/cents), never a decimal.`);
  }
  if (value < min) throw badRequest(`Field "${field}" must be at least ${min}.`);
  return value;
}

/** 125000 minor NGN → "₦1,250.00". Unknown currency → "XXX 1,250.00". */
export function formatMoney(minor: number, currency: string): string {
  const major = Math.trunc(minor / 100);
  const cents = Math.abs(minor % 100);
  const sign = minor < 0 ? "-" : "";
  const grouped = Math.abs(major)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const amount = `${sign}${grouped}.${String(cents).padStart(2, "0")}`;
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()];
  return symbol !== undefined ? `${symbol}${amount}` : `${currency.toUpperCase()} ${amount}`;
}

/** Major units (e.g. 1250.00) → minor units, rounding half-up. Only used at provider boundaries (Flutterwave takes major units). */
export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

/** Minor units → major units (e.g. 125000 → 1250). Only used at provider boundaries. */
export function toMajorUnits(minor: number): number {
  return minor / 100;
}
