export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteMetadata {
  method: HttpMethod;
  path: string;
  filePath: string;
  handler: string;
}

export type ShapeFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export type ExpectedShape = Record<string, ShapeFieldType>;

export interface TestCase {
  name: string;
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  expectedStatus: number;
  expectedShape?: ExpectedShape;
}

export interface TestResult {
  testCase: TestCase;
  passed: boolean;
  actualStatus: number;
  actualBody: unknown;
  responseTime: number;
  error?: string;
}

export interface BugReport {
  title: string;
  description: string;
  filePath: string;
  context: string[];
}

export interface SemanticIssue {
  element: string;
  issue: string;
  confidence: number;
}

export interface UICompareResult {
  route: string;
  screenshotPath: string;
  figmaPath: string;
  mismatchRatio: number;
  diffImagePath?: string;
  semanticIssues?: SemanticIssue[];
  passed: boolean;
}

export type PatchOutcome = 'fixed' | 'human_review';

export type FigmaRouteMap = Record<string, string>;

export interface GeneratedCredentials {
  email: string;
  password: string;
  name?: string;
}

export interface BrowserDiagnostic {
  type: 'console' | 'pageerror' | 'requestfailed';
  message: string;
  url?: string;
}

export interface FrontendE2eOptions {
  mobile?: boolean;
  baseUrl?: string;
}

export interface FrontendE2eResult {
  passed: boolean;
  stepsCompleted: string[];
  diagnostics: BrowserDiagnostic[];
  credentials: GeneratedCredentials;
  failureScreenshot?: string;
}

/** Aggregated output from one full frontend + backend test pass. */
export interface QaRunArtifacts {
  integrationSummary: {
    endpointsDiscovered: number;
    testsTotal: number;
    testsPassed: number;
    testsFailed: number;
    aborted: boolean;
    abortReason?: string;
    backendProfile?: string;
    e2eScenarioRan?: boolean;
    openRouterVerified: boolean;
    openRouterGeneratedTests: boolean;
  };
  frontendE2e?: FrontendE2eResult;
  frontendE2eError?: string;
  coverageEstimate: {
    passRate: number;
    failureRate: number;
    consoleErrorCount: number;
  };
}

export interface SelfImprovementPatch {
  filePath: string;
  reason: string;
  content: string;
}

export interface EvolutionAnalysis {
  gaps: string[];
  patches: SelfImprovementPatch[];
}

export interface EvolutionGenerationResult {
  generation: number;
  gaps: string[];
  filesModified: string[];
  compilationPassed: boolean;
  rolledBack: string[];
  retestArtifacts?: QaRunArtifacts;
}

export interface EvolutionLoopResult {
  generationsRun: number;
  results: EvolutionGenerationResult[];
  finalArtifacts: QaRunArtifacts;
}
