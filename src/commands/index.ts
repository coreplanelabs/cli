import { registry } from '../registry';
import { authCommands } from './auth';
import { configCommands } from './config';
import { helpCommand } from './help';
import { updateCommand } from './update';
import { caseCommands } from './case';
import { serviceCommands } from './service';
import { repoCommands } from './repo';
import { wikiCommands } from './wiki';
import { memoryCommands } from './memory';
import { threadCommands } from './thread';
import { automationCommands } from './automation';
import { integrationCommands } from './integration';
import { cloudCommands } from './cloud';
import { workspaceCommands } from './workspace';
import { apiCommands } from './api';
import { telemetryCommands } from './telemetry';
import { skillCommands } from './skill';

let registered = false;

export function registerAllCommands(): void {
  if (registered) return;
  registered = true;

  const all = [
    ...caseCommands,
    ...serviceCommands,
    ...repoCommands,
    ...wikiCommands,
    ...memoryCommands,
    ...threadCommands,
    ...skillCommands,
    ...automationCommands,
    ...integrationCommands,
    ...cloudCommands,
    ...workspaceCommands,
    ...authCommands,
    ...configCommands,
    ...apiCommands,
    ...telemetryCommands,
    helpCommand,
    updateCommand,
  ];

  for (const cmd of all) {
    registry.register(cmd);
  }
}
