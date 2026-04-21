import { threadListCommand } from './list';
import { threadShowCommand } from './show';
import { threadAskCommand } from './ask';
import { threadContinueCommand } from './continue';
import { threadExportCommand } from './export';

export const threadCommands = [
  threadListCommand,
  threadShowCommand,
  threadAskCommand,
  threadContinueCommand,
  threadExportCommand,
];
