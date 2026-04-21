import { wikiListCommand } from './list';
import { wikiShowCommand } from './show';
import { wikiFindCommand } from './find';
import { wikiDocsCommand } from './docs';
import { wikiReadCommand } from './read';

export const wikiCommands = [
  wikiListCommand,
  wikiShowCommand,
  wikiFindCommand,
  wikiDocsCommand,
  wikiReadCommand,
];
