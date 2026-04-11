/**
 * Research-Question-Aligned Test Cases
 * =====================================
 * Every MCP tool has exactly ONE test case in EACH of the four RQ arrays.
 * This gives full 4×N coverage: every tool is measured against every research
 * question dimension independently.
 *
 *   RQ1 — Architectural properties: context construction & constraints
 *   RQ2 — Metadata quality: hallucinations, semantic shifts, misclassifications
 *   RQ3 — Professional roles: librarian epistemic responsibility
 *   RQ4 — Regulatory alignment: GDPR / EU AI Act compatibility
 *
 * Tool inventory (90 tools, matching README table):
 *   agh_get_item, agh_search,
 *   amu_get_item, amu_search,
 *   baztol_browse_domain, baztol_get_resource, baztol_search,
 *   bdl_get_data_by_unit, bdl_get_data_by_variable, bdl_get_variable,
 *   bdl_search_subjects, bdl_search_units, bdl_search_variables,
 *   blz_get_listing, blz_listing_categories, blz_search,
 *   bn_get_article, bn_search_articles, bn_search_publications,
 *   bs_sejm_get_item, bs_sejm_search,
 *   dane_get_dataset, dane_search,
 *   dokumenty_slaska_get_page, dokumenty_slaska_medieval_catalog,
 *   eval_response,
 *   filmpolski_get_item, filmpolski_search,
 *   fn_repo_browse_kind, fn_repo_film_index, fn_repo_get_node, fn_repo_search,
 *   fototeka_get_photo, fototeka_search,
 *   fototekaslaska_get_photo, fototekaslaska_search,
 *   gapla_get_poster, gapla_search,
 *   icm_get_item, icm_search,
 *   imgw_hydro, imgw_meteo, imgw_synop, imgw_warnings,
 *   isap_get_act, isap_search_acts,
 *   ludzie_get_scientist, ludzie_search, ludzie_semantic_search,
 *   nac_get_page, nac_get_post, nac_news_rss, nac_site_search,
 *   ninateka_get_vod, ninateka_search,
 *   pauart_get_artwork, pauart_search,
 *   pbn_get_publication, pbn_search_persons, pbn_search_publications,
 *   pkn_search,
 *   polon_search,
 *   rcin_get_record, rcin_search,
 *   repod_get_dataset, repod_search,
 *   rodbuk_search,
 *   ruj_get_item, ruj_search,
 *   saos_dump_common_courts, saos_dump_enrichments, saos_dump_judgments,
 *   saos_dump_sc_chambers, saos_dump_services,
 *   saos_get_judgment, saos_search_judgments,
 *   sum_aleph_find, sum_aleph_present,
 *   uafm_get_item, uafm_search,
 *   wiedza_get_standard, wiedza_search_norms,
 *   wolnelektury_filter_books, wolnelektury_get_book,
 *   wolnelektury_get_collection, wolnelektury_list_taxonomy
 */
export type ResearchQuestion = "RQ1" | "RQ2" | "RQ3" | "RQ4";
export type MetadataSchema = "MARC21" | "DublinCore" | "JATS" | "HAL_JSON" | "custom";
export type QueryLanguage = "pl" | "en" | "mixed";
export type QueryType = "author_lookup" | "subject_search" | "boolean_search" | "classification_lookup" | "metadata_enrichment" | "cross_repository" | "regulatory_check" | "pii_probe";
export interface ScenarioStep {
    id: string;
    tool: string;
    toolArgs: Record<string, unknown>;
}
export interface EvalScenario {
    steps: ScenarioStep[];
    scoreFromStepId?: string;
}
export interface EvalTestCase {
    id: string;
    name: string;
    rq: ResearchQuestion[];
    tool: string;
    toolArgs: Record<string, unknown>;
    queryLanguage: QueryLanguage;
    queryType: QueryType;
    metadataSchema: MetadataSchema;
    requiredFields: string[];
    sensitiveFields: string[];
    groundTruth?: Record<string, string>;
    expectedClassificationPrefix?: string;
    piiProbe?: boolean;
    crossRepository?: boolean;
    scenario?: EvalScenario;
    description: string;
}
export declare const RQ1_CASES: EvalTestCase[];
export declare const RQ2_CASES: EvalTestCase[];
export declare const RQ3_CASES: EvalTestCase[];
export declare const RQ4_CASES: EvalTestCase[];
/** @deprecated Use ALL_TEST_CASES — EXTENDED_CASES is now empty. */
export declare const EXTENDED_CASES: EvalTestCase[];
export declare const ALL_TEST_CASES: EvalTestCase[];
export declare function getCasesByRQ(rq: ResearchQuestion): EvalTestCase[];
export declare function getCasesByTool(tool: string): EvalTestCase[];
export declare function getTestCaseById(id: string): EvalTestCase | undefined;
/**
 * For post-hoc `eval_response` scoring: pass this as `selectedTool` in
 * `computeCompositeScore` (metrics.ts), so RQ1-M3 uses the benchmark catalog tool
 * (e.g. `bn_search_articles`) rather than the literal `eval_response`.
 */
export declare function toolForEvalResponseCompositeScore(testCase: EvalTestCase): string;
export declare function getCasesBySchema(schema: MetadataSchema): EvalTestCase[];
