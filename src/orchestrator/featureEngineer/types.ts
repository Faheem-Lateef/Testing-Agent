export type AgentState =
  | 'IDLE'
  | 'READING_CONTEXT'
  | 'INJECTING_CODE'
  | 'COMPILING'
  | 'GENERATING_TESTS'
  | 'TESTING'
  | 'DEBUGGING'
  | 'REPORTING'
  | 'COMPLETED'
  | 'FAILED';

export type LifecyclePhase =
  | 'PHASE_1_DEVELOPMENT'
  | 'PHASE_2_TEST_ARCHITECTURE'
  | 'PHASE_3_SELF_HEALING'
  | 'PHASE_4_REPORTING';

export const MAX_COMPILE_ATTEMPTS = 3;
export const MAX_HEAL_ATTEMPTS = 4;

/** @deprecated Use MAX_COMPILE_ATTEMPTS / MAX_HEAL_ATTEMPTS */
export const MAX_EVOLUTION_ATTEMPTS = MAX_COMPILE_ATTEMPTS;

export interface ProjectMemoryBank {
  sourcePath: string;
  rawContent: string;
  apiVersionPrefix: string;
  databaseProfile: string;
  errorUtilityHint: string;
  frontendFramework: string;
  designTokens: string[];
  constraints: string[];
}

export type CodeAnchorKind =
  | 'express_route_index'
  | 'express_router_use'
  | 'react_form_block'
  | 'react_component_export'
  | 'file_append';

export interface CodeAnchorMatch {
  kind: CodeAnchorKind;
  filePath: string;
  lineIndex: number;
  lineContent: string;
  confidence: number;
}

export interface CodeInjectionSpec {
  filePath: string;
  anchorKind: CodeAnchorKind;
  linesToInsert: string[];
  newFileContent?: string;
  /** When true, overwrite entire file (new files or explicit heal). */
  replaceEntireFile?: boolean;
}

export interface FileChangeRecord {
  repo: 'backend' | 'frontend' | 'qa-agent';
  relativePath: string;
  absolutePath: string;
  action: 'created' | 'modified';
}

export interface CompileSandboxResult {
  project: 'backend' | 'frontend' | 'qa-agent';
  cwd: string;
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DebugAnalysisResponse {
  bugFound: boolean;
  targetFile: string;
  rootCause: string;
  fixedInjectedCode: string;
  layer?: 'mongoose' | 'express' | 'frontend' | 'test' | 'unknown';
  replaceEntireFile?: boolean;
}

export interface DevelopmentPhaseOutput {
  injections: CodeInjectionSpec[];
  rawBlocks: Array<{ filePath: string; content: string; repo?: 'backend' | 'frontend' }>;
}

export interface FeatureJourneyResult {
  passed: boolean;
  steps: string[];
  error?: string;
  stackTrace?: string;
  subtotalBefore?: number;
  subtotalAfter?: number;
  discountPercent?: number;
  couponCode?: string;
}

export interface TestMilestone {
  id: string;
  label: string;
  passed: boolean;
}

export interface HealCycleRecord {
  cycle: number;
  journeyResult: FeatureJourneyResult;
  debugAnalysis?: DebugAnalysisResponse;
  fixesApplied: string[];
}

export interface FeatureEngineerOptions {
  featureSpec: string;
  backendRoot?: string;
  frontendRoot?: string;
  skipPlaywright?: boolean;
}

export interface FeatureEngineerAttempt {
  attempt: number;
  state: AgentState;
  compileResults: CompileSandboxResult[];
  e2ePassed?: boolean;
  debugAnalysis?: DebugAnalysisResponse;
}

export interface FeatureEngineerResult {
  finalState: AgentState;
  phase: LifecyclePhase;
  fileChanges: FileChangeRecord[];
  generatedTestPath: string | null;
  testMilestones: TestMilestone[];
  healCycles: HealCycleRecord[];
  compileAttempts: number;
  healAttempts: number;
  attempts: FeatureEngineerAttempt[];
  memoryBank: ProjectMemoryBank | null;
  engineeringReport: string;
  /** @deprecated */
  diagnosticReport: string;
}
