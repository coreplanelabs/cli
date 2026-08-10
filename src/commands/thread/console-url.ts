import type { Config } from '../../config/schema';
import type { Thread } from '../../generated/types';
import { consoleBaseUrl } from '../../auth/oauth';

export interface ThreadUrlApi {
  workspacesGet(id: string): Promise<{ slug: string }>;
}

export async function threadConsoleUrl(
  config: Config,
  api: ThreadUrlApi,
  thread: Pick<Thread, 'id' | 'workspaceId'> & { _html_url?: string }
): Promise<string> {
  if (thread._html_url) return thread._html_url;
  try {
    const workspace = await api.workspacesGet(thread.workspaceId);
    return `${consoleBaseUrl(config)}/${workspace.slug}/threads/${thread.id}`;
  } catch {
    return consoleBaseUrl(config);
  }
}
