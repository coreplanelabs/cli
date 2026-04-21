import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { NominalAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, requirePositional, getArgString } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

export const wikiReadCommand: Command = {
  name: 'wiki read',
  description: 'Read a wiki document as markdown',
  operationId: 'wikis.docs.get.markdown',
  positional: [
    { name: 'wiki-id', description: 'The wiki ID' },
    { name: 'filename', description: 'Document filename (e.g. 01-overview.md)' },
  ],
  options: [{ flag: '--version <v>', description: 'Wiki version (default: active)', type: 'string' }],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);
    const wikiId = requirePositional(args, 0, 'wiki-id');
    const filename = requirePositional(args, 1, 'filename');

    const api = new NominalAPI(config);

    let version = getArgString(args, 'version');
    if (!version) {
      const wiki = await api.wikisGet(workspaceId, wikiId);
      if (!wiki.version) {
        throw new CLIError('Wiki has no active version', ExitCode.GENERAL);
      }
      version = wiki.version;
    }

    const result = await api.wikisDocsGetMarkdown({ workspaceId, wikiId, version, filename });

    if (config.output === 'json') {
      formatOutput(config, result);
      return;
    }
    process.stdout.write(result.markdown);
    if (!result.markdown.endsWith('\n')) process.stdout.write('\n');
  },
};
