import * as fs from 'fs';
import * as path from 'path';
import {getValidDirectories} from './utils';
import {IRule, IDisabledInterval} from './language';

const camelize = require('underscore.string').camelize;

export interface IEnableDisablePosition {
  isEnabled: boolean;
  position: number;
}

function loadInternalSymbol(name: string, dirs: string | string[], suffix: string) {
  let Sym;
  let directories = getValidDirectories(dirs);
  for (let dir of directories) {
    if (dir != null) {
      Sym = findSymbol(name, suffix, dir);
      if (Sym !== null) {
        return new Sym;
      }
    }
  }
  return undefined;
}

export function loadFormatter(name: string, formatterDirectories: string | string[]) {
  return loadInternalSymbol(name, formatterDirectories, 'Formatter');
}

export function loadReporter(name: string, reportersDirectories: string | string[]) {
  return loadInternalSymbol(name, reportersDirectories, 'Reporter');
}

export function loadRules(ruleConfiguration: {[name: string]: any},
              enableDisableRuleMap: {[rulename: string]: IEnableDisablePosition[]},
              rulesDirectories?: string[]): IRule[] {
  const rules: IRule[] = [];
  const notFoundRules: string[] = [];

  for (const ruleName in ruleConfiguration) {
    if (ruleConfiguration.hasOwnProperty(ruleName)) {
      const ruleValue = ruleConfiguration[ruleName];
      const Rule = findSymbol(ruleName, 'Rule', rulesDirectories);
      if (Rule == null) {
        notFoundRules.push(ruleName);
      } else {
        const all = 'all'; // make the linter happy until we can turn it on and off
        const allList = (all in enableDisableRuleMap ? enableDisableRuleMap[all] : []);
        const ruleSpecificList = (ruleName in enableDisableRuleMap ? enableDisableRuleMap[ruleName] : []);
        const disabledIntervals = buildDisabledIntervalsFromSwitches(ruleSpecificList, allList);
        rules.push(new Rule(ruleName, ruleValue, disabledIntervals));
      }
    }
  }

  if (notFoundRules.length > 0) {
    const ERROR_MESSAGE = `
      Could not find implementations for the following rules specified in the configuration:
      ${notFoundRules.join('\n')}
      Try upgrading Codelyzer and/or ensuring that you have all necessary custom rules installed.
    `;
    throw new Error(ERROR_MESSAGE);
  } else {
    return rules;
  }
}

export function findSymbol(name: string, suffix: string, symbolsDirectories?: string | string[]) {
  let result;
  let directories = getValidDirectories(symbolsDirectories);
  for (let symbolsDirectory of directories) {
    if (symbolsDirectory != null) {
      result = loadSymbol(symbolsDirectory, name, suffix);
      if (result != null) {
        return result;
      }
    }
  }
  return undefined;
}

function transformName(name: string, suffix: string) {
  const nameMatch = name.match(/^([-_]*)(.*?)([-_]*)$/);
  let result = name;
  if (nameMatch !== null) {
    result = nameMatch[1] + camelize(nameMatch[2]) + nameMatch[3];
  }
  return result[0].toUpperCase() + result.substring(1, name.length) + suffix;
}

function loadSymbol(directory: string, symbolName: string, suffix: string) {
  const camelizedName = transformName(symbolName, suffix);
  if (fs.existsSync(directory)) {
    const symbolModule = require(directory);
    if (symbolModule) {
      return symbolModule.filter(symbol => {
        if (symbol.name === camelizedName || symbol.RULE_NAME === symbolName) {
          return true;
        }
        return false;
      }).pop();
    }
  }
  return undefined;
}

/*
 * We're assuming both lists are already sorted top-down so compare the tops, use the smallest of the two,
 * and build the intervals that way.
 */
function buildDisabledIntervalsFromSwitches(ruleSpecificList: IEnableDisablePosition[], allList: IEnableDisablePosition[]) {
  let isCurrentlyDisabled = false;
  let disabledStartPosition: number;
  const disabledIntervalList: IDisabledInterval[] = [];
  let i = 0;
  let j = 0;

  while (i < ruleSpecificList.length || j < allList.length) {
    const ruleSpecificTopPositon = (i < ruleSpecificList.length ? ruleSpecificList[i].position : Infinity);
    const allTopPositon = (j < allList.length ? allList[j].position : Infinity);
    let newPositionToCheck: IEnableDisablePosition;
    if (ruleSpecificTopPositon < allTopPositon) {
      newPositionToCheck = ruleSpecificList[i];
      i++;
    } else {
      newPositionToCheck = allList[j];
      j++;
    }

    // we're currently disabled and enabling, or currently enabled and disabling -- a switch
    if (newPositionToCheck.isEnabled === isCurrentlyDisabled) {
      if (!isCurrentlyDisabled) {
        // start a new interval
        disabledStartPosition = newPositionToCheck.position;
        isCurrentlyDisabled = true;
      } else {
        // we're currently disabled and about to enable -- end the interval
        disabledIntervalList.push({
          endPosition: newPositionToCheck.position,
          startPosition: disabledStartPosition,
        });
        isCurrentlyDisabled = false;
      }
    }
  }

  if (isCurrentlyDisabled) {
    // we started an interval but didn't finish one -- so finish it with an Infinity
    disabledIntervalList.push({
      endPosition: Infinity,
      startPosition: disabledStartPosition,
    });
  }
  return disabledIntervalList;
}

