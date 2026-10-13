// Server code depends on the interface and types; the composition root picks an implementation.
// Nothing here re-exports an SDK type. Only `providers/anthropic.ts` imports one.
export type {
  CallRecorder,
  JsonSchema,
  TokenUsage,
  UmpireCallRecord,
  UmpireClient,
  UmpireRequest,
  UmpireResponse,
  UmpireStage,
} from './umpireClient.js';
export { UmpireError } from './umpireClient.js';
export {
  DEFAULT_UMPIRE_CONFIG,
  UMPIRE_STAGES,
  loadUmpireConfig,
  umpireConfigFromEnv,
} from './config.js';
export type { ProviderSpec, StageRoute, UmpireConfig, UmpireConfigFile } from './config.js';
export { TransportError } from './provider.js';
export type {
  ChatMessage,
  LlmProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
  StructuredOutputSupport,
} from './provider.js';
export { ProviderRegistry } from './registry.js';
export type { ProviderContext, ProviderFactory } from './registry.js';
export { ProviderUmpireClient } from './providerUmpireClient.js';
export type { ProviderUmpireClientOptions } from './providerUmpireClient.js';
export { BudgetedUmpireClient, RateLimitedUmpireClient } from './decorators.js';
export type { BudgetOptions, RateLimitOptions } from './decorators.js';
export { COMMANDER_BUDGET_SHARE, GameUmpireClient, createGameUmpire } from './gameLimits.js';
export type {
  GameLimits,
  GameUmpireMetric,
  GameUmpireOptions,
  GameUmpireReport,
} from './gameLimits.js';
export { PlaybackUmpireClient } from './playbackUmpireClient.js';
export { FallbackUmpireClient } from './fallbackUmpireClient.js';
export type { FallbackUmpireOptions, UmpireFallback } from './fallbackUmpireClient.js';
export { createUmpireClient } from './createUmpireClient.js';
export type { CreateUmpireClientOptions } from './createUmpireClient.js';
export {
  AnthropicProvider,
  OllamaProvider,
  OpenAiCompatibleProvider,
  TEST_MODEL,
  TestProvider,
  defaultProviderRegistry,
} from './providers/index.js';
export { MockUmpireClient, loadFixtures, loadFixtureFile } from './mockUmpireClient.js';
export type { FixtureFailure, MockUmpireClientOptions, UmpireFixture } from './mockUmpireClient.js';
export {
  JUDGE_PLACEMENT_PROMPT_VERSION,
  JUDGE_PLACEMENT_SCHEMA,
  JUDGE_PLACEMENT_SYSTEM,
  judgePlacementInput,
  judgePlacements,
} from './judgePlacement.js';
export type { JudgePlacementOutput } from './judgePlacement.js';
export {
  JUDGE_SITUATION_PROMPT_VERSION,
  JUDGE_SITUATION_SCHEMA,
  JUDGE_SITUATION_SYSTEM,
  judgeSituationSystem,
  judgeSituation,
  judgeSituationInput,
} from './judgeSituation.js';
export type {
  JudgeSituationOptions,
  JudgeSituationOutput,
  JudgeSituationResult,
} from './judgeSituation.js';
export {
  NARRATE_PROMPT_VERSION,
  NARRATE_SCHEMA,
  NARRATE_SYSTEM,
  NARRATE_WINDOW_BASE_MS,
  NARRATE_WINDOW_MAX_MS,
  STAFF_OVERLOADED_NOTICE,
  checkNarration,
  checkProse,
  narrateInput,
  narrateReports,
  narrateWindowMs,
  reportsDueForNarration,
} from './narrate.js';
export type { NarrateOptions, NarrateOutput, NarrateResult, NarratedDispatch } from './narrate.js';
export {
  BREAKER_FAILURES,
  BREAKER_RECENT,
  breakerAllows,
  breakerAt,
  breakerCooldownMs,
  breakerSummary,
  closedBreaker,
  recordNarrateCall,
} from './narrateBreaker.js';
export type { NarrateBreakerState } from './narrateBreaker.js';
export {
  STAFF_MESSAGE_KINDS,
  STAFF_PROMPT_VERSION,
  STAFF_SCHEMA,
  STAFF_SYSTEM,
  STAFF_ANSWER_PROMPT_VERSION,
  STAFF_ANSWER_SYSTEM,
  StaffRoster,
  answerStaffQuestion,
  cannedAnswer,
  checkStaffOutput,
  conferenceOfficers,
  runStaff,
  staffInput,
  staffOfficer,
  staffOfficerFor,
  writeStaffAnswer,
} from './staff.js';
export type {
  ConferenceRole,
  StaffAnswer,
  StaffMessage,
  StaffMessageKind,
  StaffOfficer,
  StaffOptions,
  StaffOutput,
  WrittenStaffAnswer,
  StaffSeat,
  StaffTurn,
} from './staff.js';
export { PERSONA_PROMPT, withPersona } from './persona.js';
