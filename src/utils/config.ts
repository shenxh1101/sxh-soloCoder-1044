import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ProjectConfig, Route, ValidationResult } from '../types';

const CONFIG_FILE = 'mock.config.json';
const DEFAULT_CONFIG: ProjectConfig = {
  name: 'mock-api-project',
  version: '1.0.0',
  port: 3000,
  baseUrl: '/api',
  routesDir: 'routes',
  defaultDelay: 0,
  defaultStatusCode: 200,
  cors: true,
  requestLogger: true,
};

export class ConfigManager {
  private cwd: string;
  private config: ProjectConfig | null = null;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  getConfigPath(): string {
    return path.join(this.cwd, CONFIG_FILE);
  }

  getRoutesDir(): string {
    this.ensureConfigLoaded();
    return path.join(this.cwd, this.config!.routesDir);
  }

  async initConfig(options?: Partial<ProjectConfig>): Promise<ProjectConfig> {
    const config: ProjectConfig = { ...DEFAULT_CONFIG, ...options };
    await fs.writeJson(this.getConfigPath(), config, { spaces: 2 });
    this.config = config;
    return config;
  }

  async loadConfig(): Promise<ProjectConfig> {
    const configPath = this.getConfigPath();
    if (!(await fs.pathExists(configPath))) {
      throw new Error(`配置文件不存在: ${configPath}，请先运行 'mock init' 初始化项目`);
    }
    this.config = await fs.readJson(configPath) as ProjectConfig;
    return this.config;
  }

  async updateConfig(updates: Partial<ProjectConfig>): Promise<ProjectConfig> {
    this.ensureConfigLoaded();
    this.config = { ...this.config!, ...updates };
    await fs.writeJson(this.getConfigPath(), this.config, { spaces: 2 });
    return this.config;
  }

  async ensureProject(): Promise<boolean> {
    try {
      await this.loadConfig();
      const routesDir = this.getRoutesDir();
      if (!(await fs.pathExists(routesDir))) {
        await fs.mkdirp(routesDir);
      }
      return true;
    } catch {
      return false;
    }
  }

  async saveRoute(route: Route): Promise<void> {
    const routesDir = this.getRoutesDir();
    await fs.mkdirp(routesDir);
    const filePath = this.getRouteFilePath(route.method, route.path);
    await fs.writeFile(filePath, yaml.dump(route, { indent: 2 }));
  }

  async loadRoute(method: string, routePath: string): Promise<Route | null> {
    const filePath = this.getRouteFilePath(method, routePath);
    if (!(await fs.pathExists(filePath))) {
      return null;
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return yaml.load(content) as Route;
  }

  async loadAllRoutes(): Promise<Route[]> {
    const routesDir = this.getRoutesDir();
    if (!(await fs.pathExists(routesDir))) {
      return [];
    }
    const files = await fs.readdir(routesDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    const routes: Route[] = [];
    for (const file of yamlFiles) {
      const filePath = path.join(routesDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const route = yaml.load(content) as Route;
        routes.push(route);
      } catch (e) {
        console.warn(`加载路由文件失败: ${file}`, (e as Error).message);
      }
    }
    return routes.sort((a, b) => {
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return a.method.localeCompare(b.method);
    });
  }

  async deleteRoute(method: string, routePath: string): Promise<boolean> {
    const filePath = this.getRouteFilePath(method, routePath);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
      return true;
    }
    return false;
  }

  async routeExists(method: string, routePath: string): Promise<boolean> {
    const filePath = this.getRouteFilePath(method, routePath);
    return fs.pathExists(filePath);
  }

  async validateRoutes(): Promise<ValidationResult[]> {
    const routes = await this.loadAllRoutes();
    const results: ValidationResult[] = [];

    for (const route of routes) {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        routePath: `${route.method} ${route.path}`,
      };

      if (!route.path || !route.path.startsWith('/')) {
        result.errors.push('路径必须以 / 开头');
      }
      if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(route.method)) {
        result.errors.push(`无效的 HTTP 方法: ${route.method}`);
      }
      if (!route.cases || route.cases.length === 0) {
        result.errors.push('至少需要一个响应 case');
      } else {
        const caseNames = new Set<string>();
        let hasDefault = false;
        for (const caseItem of route.cases) {
          if (!caseItem.name) {
            result.errors.push('所有 case 必须有 name 字段');
          } else if (caseNames.has(caseItem.name)) {
            result.errors.push(`case 名称重复: ${caseItem.name}`);
          }
          caseNames.add(caseItem.name);
          if (caseItem.default) hasDefault = true;
          if (caseItem.statusCode < 100 || caseItem.statusCode >= 600) {
            result.errors.push(`无效的状态码: ${caseItem.statusCode} (case: ${caseItem.name})`);
          }
          if (caseItem.delay !== undefined && (caseItem.delay < 0 || caseItem.delay > 60000)) {
            result.warnings.push(`延迟值建议在 0-60000ms 之间 (case: ${caseItem.name})`);
          }
        }
        if (!hasDefault && route.cases.length > 1) {
          result.warnings.push('多个 case 时建议设置一个 default case');
        }
        if (route.activeCase && !caseNames.has(route.activeCase)) {
          result.errors.push(`activeCase '${route.activeCase}' 不存在于 case 列表中`);
        }
      }

      result.valid = result.errors.length === 0;
      results.push(result);
    }

    return results;
  }

  private getRouteFilePath(method: string, routePath: string): string {
    const safePath = routePath.replace(/\//g, '_').replace(/[:*?]/g, '');
    const fileName = `${method.toLowerCase()}${safePath}.yaml`;
    return path.join(this.getRoutesDir(), fileName);
  }

  private ensureConfigLoaded(): void {
    if (!this.config) {
      throw new Error('配置未加载，请先调用 loadConfig()');
    }
  }

  getConfig(): ProjectConfig {
    this.ensureConfigLoaded();
    return this.config!;
  }
}
