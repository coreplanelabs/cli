import { noteListCommand } from './list';
import { noteShowCommand } from './show';
import { noteSaveCommand } from './save';
import { noteDeleteCommand } from './delete';
import { noteGlobalShowCommand } from './global-show';
import { noteGlobalSetCommand } from './global-set';
import { noteGlobalClearCommand } from './global-clear';

export const noteCommands = [
  noteListCommand,
  noteShowCommand,
  noteSaveCommand,
  noteDeleteCommand,
  noteGlobalShowCommand,
  noteGlobalSetCommand,
  noteGlobalClearCommand,
];
