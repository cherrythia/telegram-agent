import { test, expect } from "bun:test";
import { validateWebhookSecret, isAllowedSender } from "./validation";

test("validateWebhookSecret: returns true for matching secret", () => {
  expect(validateWebhookSecret("my-secret", "my-secret")).toBe(true);
});

test("validateWebhookSecret: returns false for wrong secret", () => {
  expect(validateWebhookSecret("wrong", "my-secret")).toBe(false);
});

test("validateWebhookSecret: returns false for null header", () => {
  expect(validateWebhookSecret(null, "my-secret")).toBe(false);
});

test("validateWebhookSecret: returns false for empty string", () => {
  expect(validateWebhookSecret("", "my-secret")).toBe(false);
});

test("isAllowedSender: returns true for known chat_id string", () => {
  expect(isAllowedSender("182526906", ["182526906"])).toBe(true);
});

test("isAllowedSender: returns false for unknown chat_id", () => {
  expect(isAllowedSender("999999", ["182526906"])).toBe(false);
});

test("isAllowedSender: coerces number to string", () => {
  expect(isAllowedSender(182526906 as unknown as string, ["182526906"])).toBe(true);
});

test("isAllowedSender: returns false for empty allowlist", () => {
  expect(isAllowedSender("182526906", [])).toBe(false);
});
