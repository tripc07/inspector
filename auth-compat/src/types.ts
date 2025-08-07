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

export interface HttpTrace {
  timestamp: string;
  method: string;
  url: string;
  headers: Record<string, any>;
  body?: any;
  response?: {
    status: number;
    headers?: Record<string, any>;
    body?: any;
  };
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
  httpTrace: HttpTrace[];
}

export interface ValidationServerConfig {
  port?: number;
  authRequired?: boolean;
  metadataLocation?: string;
  mockAuthServerUrl?: string;
}