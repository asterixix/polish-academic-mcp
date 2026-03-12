/**
 * Post-processing evaluation helpers.
 *
 * Compares LLM-generated text against the original MARC/Dublin Core record
 * to compute hallucination markers, classification drift, and language quality
 * flags for the `withResponseGenerationSpan` ResponseMeta.
 *
 * These functions run *after* LLM generation and *before* the response span
 * is closed.  They are intentionally lightweight — no external API calls,
 * no heavy NLP — to stay within the Cloudflare Workers CPU budget.
 */

import { estimateTokens } from "./tracing.js";
import type { ResponseMeta } from "./tracing.js";

/**
 * Compare an LLM-generated description against the original metadata record.
 * Returns a partial ResponseMeta containing hallucination and classification markers.
 *
 * @param sourceRecord  Key→value map of the original record fields
 *                      e.g. { title: "...", author: "...", ukd: "347.97", ... }
 * @param generated     Full text of the LLM-generated response
 */
export function evalResponse(
  sourceRecord: Record<string, string>,
  generated: string,
): Pick<
  ResponseMeta,
  | "hallucinationDetected"
  | "hallucinationType"
  | "fidelityScore"
  | "fieldsCited"
  | "fieldsAdded"
  | "originalClassification"
  | "generatedClassification"
  | "classificationMatch"
  | "hasTransliterationError"
  | "hasCodeSwitching"
  | "diacriticErrorsCount"
  | "codeSwitchSentenceCount"
  | "sourceHasUkd"
  | "sourceHasKaba"
  | "ukdDigitsMatch"
  | "ukdDepthOriginal"
  | "ukdDepthGenerated"
  | "driftDirection"
  | "schemaType"
  | "sourceFieldCount"
  | "titlePreserved"
  | "subjectGeneralized"
  | "abstractTruncated"
  | "abstractExpanded"
> {
  const sourceText = Object.values(sourceRecord).join(" ").toLowerCase();
  const genLower = generated.toLowerCase();

  // ── Fragment attribution ─────────────────────────────────────────────────
  // Fields cited: source field values that appear verbatim in generated text
  const fieldsCited = Object.entries(sourceRecord)
    .filter(([, v]) =>
      v.length >= 4 &&
      genLower.includes(v.toLowerCase().slice(0, Math.min(20, v.length)))
    )
    .map(([k]) => k);

  // Naive fidelity: proportion of generated words found in source text
  const genWords = generated.toLowerCase().split(/\s+/).filter(Boolean);
  const matchCount = genWords.filter((w) => w.length > 3 && sourceText.includes(w)).length;
  const fidelityScore = genWords.length > 0 ? matchCount / genWords.length : 0;

  // Fields added: words in generated text not traceable to source
  const fieldsAdded = genWords
    .filter((w) => w.length > 5 && !sourceText.includes(w))
    .slice(0, 10); // cap to avoid large attribute values

  // ── Classification drift ─────────────────────────────────────────────────
  const ukdPattern = /\b\d{1,3}(\.\d+)+\b/g;
  const originalClassification = sourceRecord["ukd"] ?? sourceRecord["subject"] ?? "";
  const generatedMatches = generated.match(ukdPattern);
  const generatedClassification = generatedMatches ? generatedMatches[0] : "";

  const ukdOrig = originalClassification.split(".");
  const ukdGen  = generatedClassification ? generatedClassification.split(".") : [];
  const ukdDepthOriginal  = ukdOrig.length;
  const ukdDepthGenerated = ukdGen.length;

  let ukdDigitsMatch = 0;
  for (let i = 0; i < Math.min(ukdOrig.length, ukdGen.length); i++) {
    if (ukdOrig[i] === ukdGen[i]) ukdDigitsMatch++;
    else break;
  }

  const classificationMatch =
    originalClassification.startsWith(generatedClassification) ||
    generatedClassification === "";

  let driftDirection: ResponseMeta["driftDirection"] = "match";
  if (!classificationMatch || ukdDigitsMatch < ukdDepthOriginal) {
    if (ukdDepthGenerated < ukdDepthOriginal) driftDirection = "generalized";
    else if (ukdDepthGenerated > ukdDepthOriginal) driftDirection = "specialized";
    else driftDirection = "shifted";
  }

  // ── Language quality ─────────────────────────────────────────────────────
  // Transliteration: look for common ą/ę/ó/ś/ź/ż/ć/ń/ł substitution patterns
  const diacriticErrors = [
    /(?<![ąęóśźżćńł])a(?=[^ąa])|ą(?=[ ,\.])/gi, // ą→a
    /e(?=[a-z]{2,}ę)/gi,                           // ę→e
    /o(?=[a-z]{2,}ó)/gi,                           // ó→o
  ];
  const diacriticErrorsCount = diacriticErrors.reduce(
    (sum, re) => sum + (generated.match(re)?.length ?? 0),
    0,
  );
  const hasTransliterationError = diacriticErrorsCount > 0 ||
    /[a-z][aeoui](?=[ąęóśźżćńł])/i.test(generated);

  const sentences = generated.split(/[.!?]+/);
  const codeSwitchSentenceCount = sentences.filter(
    (s) =>
      /[ąęóśźżćńł]/i.test(s) &&
      /\b(the|and|for|with|from|that|research|study|analysis)\b/i.test(s),
  ).length;
  const hasCodeSwitching = codeSwitchSentenceCount > 0;

  // ── Schema detection ─────────────────────────────────────────────────────
  const keys = Object.keys(sourceRecord);
  let schemaType: ResponseMeta["schemaType"] = "custom";
  if (keys.some((k) => /^dc[.:]/i.test(k)) || "dc:title" in sourceRecord) {
    schemaType = "DublinCore";
  } else if ("leader" in sourceRecord || keys.some((k) => /^\d{3}/.test(k))) {
    schemaType = "MARC21";
  }

  // ── Semantic shift ───────────────────────────────────────────────────────
  const sourceTitle = (sourceRecord["title"] ?? "").toLowerCase();
  const titlePreserved =
    sourceTitle.length > 0 && genLower.includes(sourceTitle.slice(0, 30));

  const sourceSubject = (sourceRecord["subject"] ?? "").toLowerCase();
  // Generalization heuristic: generated subject is shorter / broader
  const subjectGeneralized =
    sourceSubject.length > 10 &&
    !genLower.includes(sourceSubject) &&
    // Check if a prefix of the subject appears (broader category)
    genLower.includes(sourceSubject.slice(0, Math.floor(sourceSubject.length / 2)));

  const sourceAbstract = sourceRecord["abstract"] ?? sourceRecord["description"] ?? "";
  const abstractTruncated =
    sourceAbstract.length > 200 &&
    generated.includes("...") &&
    estimateTokens(generated) < estimateTokens(sourceAbstract) * 0.6;
  const abstractExpanded =
    sourceAbstract.length > 0 &&
    estimateTokens(generated) > estimateTokens(sourceAbstract) * 1.5;

  // ── Hallucination summary ────────────────────────────────────────────────
  const hallucinationDetected = fidelityScore < 0.6 || fieldsAdded.length > 5;
  let hallucinationType: ResponseMeta["hallucinationType"] = "none";
  if (hallucinationDetected) {
    if (!classificationMatch) hallucinationType = "classification";
    else if (fieldsAdded.length > 3) hallucinationType = "factual";
    else hallucinationType = "semantic_shift";
  }

  return {
    hallucinationDetected,
    hallucinationType,
    fidelityScore,
    fieldsCited,
    fieldsAdded,
    originalClassification,
    generatedClassification,
    classificationMatch,
    hasTransliterationError,
    hasCodeSwitching,
    diacriticErrorsCount,
    codeSwitchSentenceCount,
    sourceHasUkd: "ukd" in sourceRecord,
    sourceHasKaba: "kaba" in sourceRecord,
    ukdDigitsMatch,
    ukdDepthOriginal,
    ukdDepthGenerated,
    driftDirection,
    schemaType,
    sourceFieldCount: keys.length,
    titlePreserved,
    subjectGeneralized,
    abstractTruncated,
    abstractExpanded,
  };
}
