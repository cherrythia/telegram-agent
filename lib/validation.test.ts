import { test, expect } from "bun:test";
import { validateWebhookSecret, isAllowedSender, stripBotMention } from "./validation";

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

test("stripBotMention: strips @botname from a group-chat command", () => {
  expect(stripBotMention("/model@superman_aios_bot")).toBe("/model");
});

test("stripBotMention: strips @botname when the command has arguments", () => {
  expect(stripBotMention("/skills@superman_aios_bot extra args")).toBe("/skills extra args");
});

test("stripBotMention: leaves a plain command (DM-style) unchanged", () => {
  expect(stripBotMention("/model")).toBe("/model");
});

test("stripBotMention: leaves non-command text unchanged, even with an @ in it", () => {
  expect(stripBotMention("hello @friend how are you")).toBe("hello @friend how are you");
});

test("stripBotMention: leaves empty string unchanged", () => {
  expect(stripBotMention("")).toBe("");
});
