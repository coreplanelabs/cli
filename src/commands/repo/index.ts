import { repoListCommand } from './list';
import { repoShowCommand } from './show';
import { repoFindCommand } from './find';
import { repoGrepCommand } from './grep';
import { repoTreeCommand } from './tree';
import { repoReadCommand } from './read';

export const repoCommands = [
  repoListCommand,
  repoShowCommand,
  repoFindCommand,
  repoGrepCommand,
  repoTreeCommand,
  repoReadCommand,
];
