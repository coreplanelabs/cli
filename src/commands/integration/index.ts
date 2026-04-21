import { integrationCatalogCommand } from './catalog';
import { integrationListCommand } from './list';
import { integrationShowCommand } from './show';
import { integrationConnectCommand } from './connect';
import { integrationDisconnectCommand } from './disconnect';
import { integrationValidateCommand } from './validate';
import { integrationValidateMcpCommand } from './validate-mcp';
import { integrationRefreshToolsCommand } from './refresh-tools';

export const integrationCommands = [
  integrationCatalogCommand,
  integrationListCommand,
  integrationShowCommand,
  integrationConnectCommand,
  integrationDisconnectCommand,
  integrationValidateCommand,
  integrationValidateMcpCommand,
  integrationRefreshToolsCommand,
];
