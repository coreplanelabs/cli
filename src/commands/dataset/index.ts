import { datasetListCommand } from './list';
import { datasetShowCommand } from './show';
import { datasetCreateCommand } from './create';
import { datasetUpdateCommand } from './update';
import { datasetDeleteCommand } from './delete';

export const datasetCommands = [
  datasetListCommand,
  datasetShowCommand,
  datasetCreateCommand,
  datasetUpdateCommand,
  datasetDeleteCommand,
];
