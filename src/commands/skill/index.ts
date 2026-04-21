import { skillListCommand } from './list';
import { skillShowCommand } from './show';
import { skillCatalogCommand } from './catalog';
import { skillDocsCommand } from './docs';
import { skillFromTemplateCommand } from './from-template';

export const skillCommands = [
  skillListCommand,
  skillShowCommand,
  skillCatalogCommand,
  skillDocsCommand,
  skillFromTemplateCommand,
];
