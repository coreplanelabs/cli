import { serviceListCommand } from './list';
import { serviceShowCommand } from './show';
import { serviceFindCommand } from './find';
import { serviceLogsCommand } from './logs';
import { serviceMetricsCommand } from './metrics';
import { serviceGraphCommand } from './graph';

export const serviceCommands = [
  serviceListCommand,
  serviceShowCommand,
  serviceFindCommand,
  serviceLogsCommand,
  serviceMetricsCommand,
  serviceGraphCommand,
];
