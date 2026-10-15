import { serviceListCommand } from './list';
import { serviceShowCommand } from './show';
import { serviceLogsCommand } from './logs';
import { serviceMetricsCommand } from './metrics';
import { serviceGraphCommand } from './graph';

export const serviceCommands = [
  serviceListCommand,
  serviceShowCommand,
  serviceLogsCommand,
  serviceMetricsCommand,
  serviceGraphCommand,
];
