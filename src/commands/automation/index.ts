import { automationListCommand } from './list';
import { automationFindCommand } from './find';
import { automationShowCommand } from './show';
import { automationTriggerCommand } from './trigger';
import { automationExecutionsCommand } from './executions';
import { automationExecutionCommand } from './execution';
import { automationRerunCommand } from './rerun';
import { automationCatalogCommand } from './catalog';
import { automationFromTemplateCommand } from './from-template';

export const automationCommands = [
  automationListCommand,
  automationFindCommand,
  automationShowCommand,
  automationTriggerCommand,
  automationExecutionsCommand,
  automationExecutionCommand,
  automationRerunCommand,
  automationCatalogCommand,
  automationFromTemplateCommand,
];
