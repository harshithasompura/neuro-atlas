import assert from "node:assert/strict";
import { test } from "node:test";
import { abstractFromInvertedIndex, deDash, normalizeWork } from "./normalize";
import { workSchema } from "./openalex";

test("abstract is rebuilt in position order", () => {
  assert.equal(abstractFromInvertedIndex({ brain: [1], The: [0], waves: [2], again: [3, 4] }), "The brain waves again again");
  assert.equal(abstractFromInvertedIndex(null), null);
  assert.equal(abstractFromInvertedIndex({}), null);
});

test("works without title or topic are dropped; others keep real fields", () => {
  const base = {
    id: "https://openalex.org/W1",
    publication_year: 2020,
    cited_by_count: 7,
    authorships: [
      { author: { display_name: "A" }, institutions: [{ display_name: "MIT" }] },
      { author: { display_name: "B" }, institutions: [{ display_name: "MIT" }, { display_name: "ETH" }] },
    ],
  };
  const topic = { id: "https://openalex.org/T1", display_name: "Sleep", subfield: { id: "https://openalex.org/subfields/2805", display_name: "Cognitive" } };
  assert.equal(normalizeWork(workSchema.parse({ ...base, title: null, primary_topic: topic })), null);
  assert.equal(normalizeWork(workSchema.parse({ ...base, title: "x", primary_topic: null })), null);
  const n = normalizeWork(workSchema.parse({ ...base, title: " Sleep spindles ", primary_topic: topic }));
  assert.ok(n);
  assert.equal(n.id, "W1");
  assert.equal(n.title, "Sleep spindles");
  assert.equal(n.citations, 7);
  assert.deepEqual(n.institutions, ["MIT", "ETH"]);
  assert.equal(n.topic.subfieldId, "2805");
});

test("em and en dashes never reach the UI", () => {
  assert.equal(deDash("Sleep \u2014 a review"), "Sleep - a review");
  assert.equal(deDash("fMRI\u2013EEG, 2015\u20132020, a\u2014b"), "fMRI-EEG, 2015-2020, a - b");
});
