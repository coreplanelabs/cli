import { caseListCommand } from './list';
import { caseShowCommand } from './show';
import { caseCreateCommand } from './create';
import { caseInvestigateCommand } from './investigate';
import { caseHypothesesCommand } from './hypotheses';
import { caseHypothesisCommand } from './hypothesis';

export const caseCommands = [
  caseListCommand,
  caseShowCommand,
  caseCreateCommand,
  caseInvestigateCommand,
  caseHypothesesCommand,
  caseHypothesisCommand,
];
