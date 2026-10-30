import { expect, test } from "bun:test";
import { openaiUrl } from "./openai-url";

test("OpenAI itself unless told otherwise", () => {
  expect(openaiUrl("/v1/chat/completions", {})).toBe("https://api.openai.com/v1/chat/completions");
  expect(openaiUrl("/v1/chat/completions", { OPENAI_BASE_OVERRIDE: "  " })).toBe("https://api.openai.com/v1/chat/completions");
});

test("a stand-in in development, with or without a trailing slash", () => {
  expect(openaiUrl("/v1/audio/transcriptions", { NODE_ENV: "development", OPENAI_BASE_OVERRIDE: "http://localhost:3999/" }))
    .toBe("http://localhost:3999/v1/audio/transcriptions");
  expect(openaiUrl("/v1/chat/completions", { OPENAI_BASE_OVERRIDE: "http://localhost:3999" }))
    .toBe("http://localhost:3999/v1/chat/completions");
});

test("production always calls OpenAI", () => {
  expect(openaiUrl("/v1/chat/completions", { NODE_ENV: "production", OPENAI_BASE_OVERRIDE: "http://evil.example" }))
    .toBe("https://api.openai.com/v1/chat/completions");
});
