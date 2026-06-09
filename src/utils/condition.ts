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

export function checkParamConditions(
  params: Record<string, any>,
  conditions?: ParameterCondition[]
): ConditionCheckResult {
  const details: ConditionCheckResult['details'] = [];

  if (!conditions || conditions.length === 0) {
    return { passed: true, details };
  }

  const allPassed = conditions.every(condition => {
    const value = params[condition.name];
    let passed = false;
    let reason = '';

    if (condition.exists !== undefined) {
      const exists = value !== undefined;
      passed = condition.exists ? exists : !exists;
      reason = condition.exists
        ? (passed ? `参数存在` : `参数不存在`)
        : (passed ? `参数不存在` : `参数存在`);
    } else if (value === undefined) {
      passed = false;
      reason = `参数不存在`;
    } else if (condition.value !== undefined) {
      passed = String(value) === String(condition.value);
      reason = passed
        ? `值匹配: ${value} === ${condition.value}`
        : `值不匹配: ${value} !== ${condition.value}`;
    } else if (condition.contains !== undefined) {
      passed = String(value).includes(condition.contains);
      reason = passed
        ? `包含子串: ${value} 包含 '${condition.contains}'`
        : `不包含子串: ${value} 不包含 '${condition.contains}'`;
    } else if (condition.matches !== undefined) {
      try {
        const regex = new RegExp(condition.matches);
        passed = regex.test(String(value));
        reason = passed
          ? `正则匹配: ${value} 匹配 /${condition.matches}/`
          : `正则不匹配: ${value} 不匹配 /${condition.matches}/`;
      } catch {
        passed = false;
        reason = `正则表达式无效: /${condition.matches}/`;
      }
    } else {
      passed = true;
      reason = `仅检查存在性，参数已存在`;
    }

    details.push({
      type: 'query',
      condition,
      actualValue: value,
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

  const queryCheck = checkParamConditions(req.query || {}, caseItem.conditions.query);
  queryCheck.details.forEach(d => d.type = 'query');
  result.queryCheck = queryCheck;

  const bodyCheck = checkParamConditions(req.body || {}, caseItem.conditions.body);
  bodyCheck.details.forEach(d => d.type = 'body');
  result.bodyCheck = bodyCheck;

  const headersCheck = checkParamConditions(req.headers || {}, caseItem.conditions.headers);
  headersCheck.details.forEach(d => d.type = 'headers');
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
