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
