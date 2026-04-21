import { cloudListCommand } from './list';
import { cloudShowCommand } from './show';
import { cloudConnectCommand } from './connect';
import { cloudDisconnectCommand } from './disconnect';
import { cloudSyncCommand } from './sync';
import { cloudValidateCommand } from './validate';

export const cloudCommands = [
  cloudListCommand,
  cloudShowCommand,
  cloudConnectCommand,
  cloudDisconnectCommand,
  cloudSyncCommand,
  cloudValidateCommand,
];
