import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { OpenAlexError, fetchSamplePage } from "./openalex";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stub = (make: () => Response) => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return make();
  }) as typeof fetch;
  return () => calls;
};

test("a 400 is surfaced immediately and never retried", async () => {
  const calls = stub(() => new Response("bad filter", { status: 400 }));
  await assert.rejects(fetchSamplePage("x:1", 100, 1, 1, {}), (e: unknown) => e instanceof OpenAlexError && e.status === 400 && /bad filter/.test(e.message));
  assert.equal(calls(), 1);
});

test("an exhausted daily budget is reported as such, not retried", async () => {
  const calls = stub(() => new Response("{}", { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "3600" } }));
  await assert.rejects(fetchSamplePage("x:1", 100, 1, 1, {}), (e: unknown) => e instanceof OpenAlexError && e.budgetExhausted && /budget/.test(e.message));
  assert.equal(calls(), 1);
});

test("records that fail schema validation are counted, not silently kept", async () => {
  const good = { id: "https://openalex.org/W1", publication_year: 2020, cited_by_count: 1, authorships: [] };
  stub(() => Response.json({ meta: { count: 2 }, results: [good, { id: "https://openalex.org/W2" }] }));
  const page = await fetchSamplePage("x:1", 100, 1, 1, {});
  assert.equal(page.works.length, 1);
  assert.equal(page.invalid, 1);
});

test("asking for more than the OpenAlex sample maximum is rejected before any request", async () => {
  const calls = stub(() => Response.json({}));
  await assert.rejects(fetchSamplePage("x:1", 10_001, 1, 1, {}), OpenAlexError);
  assert.equal(calls(), 0);
});
