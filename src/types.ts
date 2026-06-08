export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface ParameterCondition {
  name: string;
  value?: string | number | boolean;
  contains?: string;
  matches?: string;
  exists?: boolean;
}

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
  override?: {
    statusCode?: number;
    delay?: number;
    body?: any;
    case?: string;
  };
}
