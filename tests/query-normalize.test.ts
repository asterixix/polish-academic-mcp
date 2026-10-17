import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeResearchQuery,
  normalizeQueryForSource,
} from "../src/query-normalize.js";

describe("normalizeResearchQuery", () => {
  it("cleans SAOS conversational query into core + year filter", () => {
    const n = normalizeResearchQuery(
      "Co mówią orzeczenia SAOS o kredytach frankowych po 2020?",
    );
    assert.match(n.core, /kredyt/i);
    assert.match(n.core, /frankowy/i);
    assert.equal(n.yearFrom, "2020-01-01");
    assert.ok(!/saos/i.test(n.core));
    assert.ok(!/orzeczen/i.test(n.core));
    assert.ok(n.hints.judgments);
  });

  it("strips Biblioteka Nauki + year from publication query", () => {
    const n = normalizeResearchQuery(
      "Artykuły o energii odnawialnej w Bibliotece Nauki z 2024",
    );
    assert.match(n.core, /energi/i);
    assert.match(n.core, /odnawialn/i);
    assert.ok(!/biblioteka/i.test(n.core));
    assert.equal(n.yearFrom, "2024-01-01");
  });

  it("strips GUS BDL from stats query", () => {
    const n = normalizeResearchQuery(
      "Bezrobocie w województwie małopolskim według GUS BDL",
    );
    assert.match(n.core, /bezroboc/i);
    assert.match(n.core, /małopolsk/i);
    assert.ok(!/\bgus\b/i.test(n.core));
    assert.ok(!/\bbdl\b/i.test(n.core));
    assert.ok(n.hints.stats);
  });

  it("produces shorter variants", () => {
    const n = normalizeResearchQuery("ochrona danych osobowych w administracji publicznej");
    assert.ok(n.variants.length >= 1);
    assert.ok(n.variants.every((v) => v.length < n.core.length || v.split(" ").length <= 3));
  });
});

describe("normalizeQueryForSource", () => {
  it("maps year into SAOS judgment_date_from", () => {
    const { query, filters } = normalizeQueryForSource(
      "SAOS kredyty frankowe orzeczenia 2020",
      "saos",
      ["all", "judgment_date_from", "page_size"],
    );
    assert.match(query, /kredyt/i);
    assert.equal(filters.judgment_date_from, "2020-01-01");
  });
});
