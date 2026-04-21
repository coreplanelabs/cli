import { memoryListCommand } from './list';
import { memoryFindCommand } from './find';
import { memoryShowCommand } from './show';
import { memorySaveCommand } from './save';
import { memoryDeleteCommand } from './delete';

export const memoryCommands = [
  memoryListCommand,
  memoryFindCommand,
  memoryShowCommand,
  memorySaveCommand,
  memoryDeleteCommand,
];
