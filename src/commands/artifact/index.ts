import { artifactListCommand } from './list';
import { artifactShowCommand } from './show';
import { artifactVersionsCommand } from './versions';
import { artifactDeleteCommand } from './delete';

export const artifactCommands = [
  artifactListCommand,
  artifactShowCommand,
  artifactVersionsCommand,
  artifactDeleteCommand,
];
