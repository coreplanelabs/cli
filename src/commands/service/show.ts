import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional } from '../helpers';
import { resolveServiceId } from './id';

type NodeTypeArg = Parameters<NominalAPI['cloudInfraNodesGet']>[0] extends { type: infer T } ? T : never;

export const serviceShowCommand: Command = {
  name: 'service show',
  description: 'Show a service with all its data',
  operationId: 'cloud_infra.nodes.get',
  positional: [
    { name: 'service-id', description: '<provider>/<account>/<region>/<type>/<id> or a short name' },
  ],
  examples: [
    'nominal service show aws/123456789/us-east-1/aws.lambda.function/payments',
    'nominal service show payments',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const raw = requirePositional(args, 0, 'service-id');
    const service = await resolveServiceId(config, raw, workspaceId);
    const api = new NominalAPI(config);
    const result = await api.cloudInfraNodesGet({
      workspaceId,
      id: service.id,
      provider: service.provider,
      account: service.account,
      region: service.region,
      type: service.type as NodeTypeArg,
    });
    formatOutput(config, result);
  },
};
