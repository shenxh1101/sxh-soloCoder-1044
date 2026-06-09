export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface ParameterCondition {
  name: string;
  value?: string | number | boolean;
  contains?: string;
  matches?: string;
  exists?: boolean;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  not?: string | number | boolean;
}

export type ConditionOperator = 'value' | 'contains' | 'matches' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte' | 'not';

export interface ResponseCase {
  name: string;
  description?: string;
  statusCode: number;
  delay?: number;
  headers?: Record<string, string>;
  body: any;
  conditions?: {
    query?: ParameterCondition[];
    body?: ParameterCondition[];
    headers?: ParameterCondition[];
  };
  default?: boolean;
}

export interface Route {
  path: string;
  method: HttpMethod;
  description?: string;
  tags?: string[];
  cases: ResponseCase[];
  activeCase?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectConfig {
  name: string;
  version: string;
  description?: string;
  port: number;
  baseUrl: string;
  routesDir: string;
  defaultDelay: number;
  defaultStatusCode: number;
  cors: boolean;
  requestLogger: boolean;
}

export interface RouteExport {
  path: string;
  method: HttpMethod;
  description?: string;
  tags?: string[];
  cases: ResponseCase[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  routePath?: string;
}

export interface ServeOptions {
  port?: number;
  host?: string;
  watch?: boolean;
  record?: boolean;
  recordDir?: string;
  override?: {
    statusCode?: number;
    delay?: number;
    body?: any;
    case?: string;
  };
}

export interface RecordedRequest {
  id: string;
  timestamp: string;
  method: HttpMethod;
  path: string;
  fullUrl: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, string>;
  response: {
    statusCode: number;
    delay: number;
    headers: Record<string, string>;
    body: any;
    caseName: string;
    selectionReason: string;
  };
  duration: number;
}

export type OperationType = 'route_add' | 'route_delete' | 'route_use' | 'case_add' | 'case_delete' | 'case_update' | 'case_default' | 'debug' | 'record_list' | 'record_show' | 'record_export' | 'record_to_case' | 'record_clear' | 'serve_start';

export interface SessionOperation {
  id: string;
  timestamp: string;
  type: OperationType;
  command: string;
  details: any;
}

export interface Session {
  id: string;
  name: string;
  startTime: string;
  endTime?: string;
  operations: SessionOperation[];
  recordedRequests: RecordedRequest[];
  active: boolean;
}
