import { readFileSync, readSync } from 'node:fs';
import type { Command } from '../../command';
import type { Config } from '../../config/schema';
import { PolylaneAPI } from '../../generated/client';
import { formatOutput } from '../../output/formatter';
import { requireWorkspace, getArgString, getArgArray, getArgNumber, getArgBoolean, parseJsonArg } from '../helpers';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';

type Automation = Parameters<PolylaneAPI['automationsPost']>[0];

function readBodyFromFile(path: string): string {
  if (path === '-') {
    const chunks: Buffer[] = [];
    const buf = Buffer.alloc(65536);
    while (true) {
      let bytesRead = 0;
      try {
        bytesRead = readSync(0, buf, 0, buf.length, null);
      } catch {
        break;
      }
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  return readFileSync(path, 'utf-8');
}

function resolveBaseBody(args: Record<string, unknown>): Record<string, unknown> {
  const raw = getArgString(args, 'body');
  if (raw !== undefined) {
    const parsed = parseJsonArg(raw, '--body');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CLIError('--body must be a JSON object', ExitCode.USAGE);
    }
    return parsed as Record<string, unknown>;
  }
  const file = getArgString(args, 'bodyFile');
  if (file !== undefined) {
    const parsed = parseJsonArg(readBodyFromFile(file), '--body-file');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new CLIError('--body-file must contain a JSON object', ExitCode.USAGE);
    }
    return parsed as Record<string, unknown>;
  }
  return {};
}

// A repeatable flag value is either inline JSON (`{"type":"cron","expression":"0 9 * * *"}`)
// or a bare type shorthand (`webhook`) that expands to `{ type: <value> }`.
function parseTypedFlag(values: string[] | undefined, flag: string): Array<Record<string, unknown>> | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((v) => {
    const trimmed = v.trim();
    if (trimmed.startsWith('{')) {
      const parsed = parseJsonArg(trimmed, flag);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new CLIError(`${flag} JSON must be an object`, ExitCode.USAGE);
      }
      return parsed as Record<string, unknown>;
    }
    return { type: trimmed };
  });
}

export const automationCreateCommand: Command = {
  name: 'automation create',
  description: 'Create an arbitrary automation (trigger → instructions → tools → actions)',
  operationId: 'automations.post',
  usage: 'polylane automation create [--name ...] [--trigger <json>]... [--instructions ...] [--body-file <path>]',
  options: [
    { flag: '--name <name>', description: 'Automation name', type: 'string' },
    { flag: '--instructions <text>', description: 'Agent instructions (the system prompt for the run)', type: 'string' },
    { flag: '--trigger <json>', description: 'Trigger as JSON, or a bare type for filterless triggers (repeatable). e.g. \'{"type":"alert","filters":{"sources":["datadog"]}}\' or webhook', type: 'array' },
    { flag: '--action <json>', description: 'Action as JSON, or a bare type (repeatable). e.g. \'{"type":"openIssue","mode":"smart"}\'', type: 'array' },
    { flag: '--destination <json>', description: 'Notification destination as JSON (repeatable). e.g. \'{"type":"slack","name":"ops","channelId":"C123"}\'', type: 'array' },
    { flag: '--tool <slug>', description: 'Skill slug to attach as a tool (repeatable). Alias: --skill', type: 'array' },
    { flag: '--skill <slug>', description: 'Alias for --tool', type: 'array' },
    { flag: '--delay <ms>', description: 'Delay before the run, in milliseconds (e.g. post-deploy wait)', type: 'number' },
    { flag: '--passes <n>', description: 'Number of parallel agent passes', type: 'number' },
    { flag: '--disabled', description: 'Create the automation in a disabled state', type: 'boolean' },
    { flag: '--body <json>', description: 'Full automation body as JSON; flags layer on top of it', type: 'string' },
    { flag: '--body-file <path>', description: 'Full automation body from a file ("-" for stdin); flags layer on top', type: 'string' },
  ],
  examples: [
    'polylane automation create --name "Triage Datadog alerts" --trigger \'{"type":"alert","filters":{"sources":["datadog"]}}\' --instructions "Correlate the alert with recent deploys and open an issue with findings." --action \'{"type":"openIssue","mode":"smart"}\' --tool investigate-errors',
    'polylane automation catalog --output json | jq \'...\'   # crib a template body, then:',
    'polylane automation create --body-file my-automation.json',
    'polylane automation create --body-file template.json --trigger \'{"type":"cloudflare.deployment","filters":{"environments":["production"]}}\'   # take a template body, narrow the trigger',
  ],
  async execute(config: Config, _flags, args: Record<string, unknown>): Promise<void> {
    const workspaceId = await requireWorkspace(config);

    const body = resolveBaseBody(args);

    // Flags layer on top of any --body/--body-file base: scalars override, arrays replace when provided.
    const name = getArgString(args, 'name');
    if (name !== undefined) body.name = name;

    const instructions = getArgString(args, 'instructions');
    const passes = getArgNumber(args, 'passes');
    if (instructions !== undefined || passes !== undefined) {
      const agentConfig = (typeof body.agentConfig === 'object' && body.agentConfig !== null ? body.agentConfig : {}) as Record<string, unknown>;
      if (instructions !== undefined) agentConfig.instructions = instructions;
      if (passes !== undefined) agentConfig.passes = { count: passes };
      body.agentConfig = agentConfig;
    }

    const triggers = parseTypedFlag(getArgArray(args, 'trigger'), '--trigger');
    if (triggers !== undefined) body.triggers = triggers;

    const actions = parseTypedFlag(getArgArray(args, 'action'), '--action');
    if (actions !== undefined) body.actions = actions;

    const destinations = parseTypedFlag(getArgArray(args, 'destination'), '--destination');
    if (destinations !== undefined) body.destinations = destinations;

    const tools = [...(getArgArray(args, 'tool') ?? []), ...(getArgArray(args, 'skill') ?? [])];
    if (tools.length > 0) body.skills = tools.map((slug) => ({ skillSlug: slug }));

    const delay = getArgNumber(args, 'delay');
    if (delay !== undefined) body.delayMs = delay;

    const disabled = getArgBoolean(args, 'disabled');
    if (disabled !== undefined) body.disabled = disabled;

    if (!Array.isArray(body.triggers) || body.triggers.length === 0) {
      throw new CLIError(
        'An automation needs at least one trigger',
        ExitCode.USAGE,
        "Pass --trigger '<json>' (or a bare type like webhook), or supply --body/--body-file.\n" +
          'See trigger and action types at https://docs.polylane.com/fix-and-automate/automations/triggers'
      );
    }

    const api = new PolylaneAPI(config);
    const automation = await api.automationsPost({ workspaceId, ...body } as Automation);
    formatOutput(config, automation);
  },
};
