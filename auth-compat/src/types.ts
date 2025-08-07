export interface TestResult {
  name: string;
  result: 'PASS' | 'FAIL';
  details: Record<string, any>;
  errors?: string[];
}

export interface ComplianceReport {
  overall_result: 'PASS' | 'FAIL';
  test_suite: string;
  timestamp: string;
  client_command: string;
  tests_passed: number;
  tests_failed: number;
  tests: TestResult[];
}

export interface ClientBehavior {
  connected: boolean;
  initialized: boolean;
  protocolVersion?: string;
  clientInfo?: Record<string, any>;
  requestsMade: string[];
  authMetadataRequested: boolean;
  authFlowCompleted: boolean;
  errors: string[];
}

export interface ValidationServerConfig {
  port?: number;
  authRequired?: boolean;
  metadataLocation?: string;
  mockAuthServerUrl?: string;
}