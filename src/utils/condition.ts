import { ParameterCondition, ResponseCase } from '../types';

export interface ConditionCheckResult {
  passed: boolean;
  details: {
    type: 'query' | 'body' | 'headers';
    condition: ParameterCondition;
    actualValue: any;
    passed: boolean;
    reason: string;
  }[];
}

function normalizeHeaders(headers: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function getParamValue(params: Record<string, any>, name: string, type: 'query' | 'body' | 'headers'): any {
  if (type === 'headers') {
    const normalized = normalizeHeaders(params);
    return normalized[name.toLowerCase()];
  }
  return params[name];
}

function parseNumber(value: any): number | null {
  const num = Number(value);
  return isNaN(num) ? null : num;
}

function checkSingleCondition(
  actualValue: any,
  condition: ParameterCondition,
  type: 'query' | 'body' | 'headers'
): { passed: boolean; reason: string } {
  if (condition.exists !== undefined) {
    const exists = actualValue !== undefined;
    const passed = condition.exists ? exists : !exists;
    const reason = condition.exists
      ? (passed ? `参数存在` : `参数不存在`)
      : (passed ? `参数不存在` : `参数存在`);
    return { passed, reason };
  }

  if (actualValue === undefined) {
    return { passed: false, reason: '参数不存在' };
  }

  if (condition.value !== undefined) {
    const actualStr = String(actualValue);
    const expectedStr = String(condition.value);
    const passed = actualStr === expectedStr;
    return {
      passed,
      reason: passed ? `值匹配: ${actualValue} === ${condition.value}` : `值不匹配: ${actualValue} !== ${condition.value}`
    };
  }

  if (condition.not !== undefined) {
    const actualStr = String(actualValue);
    const expectedStr = String(condition.not);
    const passed = actualStr !== expectedStr;
    return {
      passed,
      reason: passed ? `值不匹配: ${actualValue} !== ${condition.not}` : `值匹配（不期望）: ${actualValue} === ${condition.not}`
    };
  }

  if (condition.contains !== undefined) {
    const actualStr = String(actualValue);
    const passed = actualStr.includes(condition.contains);
    return {
      passed,
      reason: passed ? `包含子串: ${actualValue} 包含 '${condition.contains}'` : `不包含子串: ${actualValue} 不包含 '${condition.contains}'`
    };
  }

  if (condition.matches !== undefined) {
    try {
      const regex = new RegExp(condition.matches);
      const passed = regex.test(String(actualValue));
      return {
        passed,
        reason: passed ? `正则匹配: ${actualValue} 匹配 /${condition.matches}/` : `正则不匹配: ${actualValue} 不匹配 /${condition.matches}/`
      };
    } catch {
      return { passed: false, reason: `正则表达式无效: /${condition.matches}/` };
    }
  }

  if (condition.gt !== undefined || condition.gte !== undefined || condition.lt !== undefined || condition.lte !== undefined) {
    const numValue = parseNumber(actualValue);
    if (numValue === null) {
      return { passed: false, reason: `值不是数字: ${actualValue}` };
    }

    if (condition.gt !== undefined && !(numValue > condition.gt)) {
      return { passed: false, reason: `值不大于: ${numValue} <= ${condition.gt}` };
    }
    if (condition.gte !== undefined && !(numValue >= condition.gte)) {
      return { passed: false, reason: `值不大于等于: ${numValue} < ${condition.gte}` };
    }
    if (condition.lt !== undefined && !(numValue < condition.lt)) {
      return { passed: false, reason: `值不小于: ${numValue} >= ${condition.lt}` };
    }
    if (condition.lte !== undefined && !(numValue <= condition.lte)) {
      return { passed: false, reason: `值不小于等于: ${numValue} > ${condition.lte}` };
    }

    const parts: string[] = [];
    if (condition.gt !== undefined) parts.push(`> ${condition.gt}`);
    if (condition.gte !== undefined) parts.push(`>= ${condition.gte}`);
    if (condition.lt !== undefined) parts.push(`< ${condition.lt}`);
    if (condition.lte !== undefined) parts.push(`<= ${condition.lte}`);
    return { passed: true, reason: `比较匹配: ${numValue} ${parts.join(', ')}` };
  }

  return { passed: true, reason: '仅检查存在性，参数已存在' };
}

export function checkParamConditions(
  params: Record<string, any>,
  conditions: ParameterCondition[] | undefined,
  type: 'query' | 'body' | 'headers'
): ConditionCheckResult {
  const details: ConditionCheckResult['details'] = [];

  if (!conditions || conditions.length === 0) {
    return { passed: true, details };
  }

  const allPassed = conditions.every(condition => {
    const actualValue = getParamValue(params, condition.name, type);
    const { passed, reason } = checkSingleCondition(actualValue, condition, type);

    details.push({
      type,
      condition,
      actualValue,
      passed,
      reason,
    });

    return passed;
  });

  return { passed: allPassed, details };
}

export interface CaseMatchResult {
  caseName: string;
  matched: boolean;
  queryCheck?: ConditionCheckResult;
  bodyCheck?: ConditionCheckResult;
  headersCheck?: ConditionCheckResult;
  overallReason: string;
}

export function checkCaseMatch(
  caseItem: ResponseCase,
  req: { query?: Record<string, any>; body?: Record<string, any>; headers?: Record<string, any> }
): CaseMatchResult {
  const result: CaseMatchResult = {
    caseName: caseItem.name,
    matched: false,
    overallReason: '',
  };

  if (!caseItem.conditions) {
    result.matched = false;
    result.overallReason = '无匹配条件，跳过条件匹配';
    return result;
  }

  const hasAnyCondition = 
    (caseItem.conditions.query?.length ?? 0) > 0 || 
    (caseItem.conditions.body?.length ?? 0) > 0 || 
    (caseItem.conditions.headers?.length ?? 0) > 0;

  if (!hasAnyCondition) {
    result.matched = true;
    result.overallReason = '条件对象为空，匹配任何无参数请求';
    return result;
  }

  const queryCheck = checkParamConditions(req.query || {}, caseItem.conditions.query, 'query');
  result.queryCheck = queryCheck;

  const bodyCheck = checkParamConditions(req.body || {}, caseItem.conditions.body, 'body');
  result.bodyCheck = bodyCheck;

  const headersCheck = checkParamConditions(req.headers || {}, caseItem.conditions.headers, 'headers');
  result.headersCheck = headersCheck;

  result.matched = queryCheck.passed && bodyCheck.passed && headersCheck.passed;

  const failedParts: string[] = [];
  if (!queryCheck.passed && caseItem.conditions.query?.length) failedParts.push('query');
  if (!bodyCheck.passed && caseItem.conditions.body?.length) failedParts.push('body');
  if (!headersCheck.passed && caseItem.conditions.headers?.length) failedParts.push('headers');

  if (result.matched) {
    result.overallReason = '所有条件匹配成功';
  } else {
    result.overallReason = `条件不匹配: ${failedParts.join(', ')}`;
  }

  return result;
}

export interface SelectCaseResult {
  selectedCase: ResponseCase;
  selectionReason: string;
  allCaseResults: CaseMatchResult[];
}

export function selectResponseCase(
  route: { cases: ResponseCase[]; activeCase?: string },
  req: { query?: Record<string, any>; body?: Record<string, any>; headers?: Record<string, any> },
  overrideCase?: string
): SelectCaseResult {
  const allCaseResults: CaseMatchResult[] = [];

  if (overrideCase) {
    const overrideCaseItem = route.cases.find(c => c.name === overrideCase);
    if (overrideCaseItem) {
      allCaseResults.push({
        caseName: overrideCase,
        matched: true,
        overallReason: '全局覆盖指定',
      });
      return {
        selectedCase: overrideCaseItem,
        selectionReason: `使用全局覆盖场景: ${overrideCase}`,
        allCaseResults,
      };
    }
  }

  for (const caseItem of route.cases) {
    const result = checkCaseMatch(caseItem, req);
    allCaseResults.push(result);
    if (result.matched) {
      return {
        selectedCase: caseItem,
        selectionReason: `条件匹配成功，使用场景: ${caseItem.name}`,
        allCaseResults,
      };
    }
  }

  if (route.activeCase) {
    const activeCase = route.cases.find(c => c.name === route.activeCase);
    if (activeCase) {
      return {
        selectedCase: activeCase,
        selectionReason: `使用当前激活场景: ${route.activeCase}`,
        allCaseResults,
      };
    }
  }

  const defaultCase = route.cases.find(c => c.default);
  if (defaultCase) {
    return {
      selectedCase: defaultCase,
      selectionReason: `使用默认场景: ${defaultCase.name}`,
      allCaseResults,
    };
  }

  return {
    selectedCase: route.cases[0],
    selectionReason: `使用第一个场景: ${route.cases[0].name}`,
    allCaseResults,
  };
}
