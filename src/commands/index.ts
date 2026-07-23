import { registry } from '../registry';
import { authCommands } from './auth';
import { configCommands } from './config';
import { helpCommand } from './help';
import { setupCommand } from './setup';
import { updateCommand } from './update';
import { feedCommands } from './feed';
import { issueCommands } from './issue';
import { serviceCommands } from './service';
import { repoCommands } from './repo';
import { memoryCommands } from './memory';
import { threadCommands } from './thread';
import { automationCommands } from './automation';
import { integrationCommands } from './integration';
import { cloudCommands } from './cloud';
import { workspaceCommands } from './workspace';
import { apiCommands } from './api';
import { telemetryCommands } from './telemetry';
import { skillCommands } from './skill';
import { noteCommands } from './note';
import { autofixCommands } from './autofix';
import { artifactCommands } from './artifact';
import { toolsCommands } from './tools';

let registered = false;

export function registerAllCommands(): void {
  if (registered) return;
  registered = true;

  const all = [
    ...feedCommands,
    ...issueCommands,
    ...serviceCommands,
    ...repoCommands,
    ...memoryCommands,
    ...threadCommands,
    ...skillCommands,
    ...automationCommands,
    ...integrationCommands,
    ...cloudCommands,
    ...workspaceCommands,
    ...noteCommands,
    ...autofixCommands,
    ...artifactCommands,
    ...toolsCommands,
    ...authCommands,
    ...configCommands,
    ...apiCommands,
    ...telemetryCommands,
    helpCommand,
    setupCommand,
    updateCommand,
  ];

  for (const cmd of all) {
    registry.register(cmd);
  }
}
