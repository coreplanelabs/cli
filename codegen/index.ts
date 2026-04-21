import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fetchSpec, resolveSpecSource } from './fetch-spec';
import { parseSpec } from './parse-spec';
import { generateTypes } from './generate-types';
import { generateClient } from './generate-client';
import { generateCommandMeta } from './generate-commands';
import { loadEnvLocal } from './env-local';

loadEnvLocal();

const GENERATED_DIR = join(process.cwd(), 'src', 'generated');

export async function generateAll(source?: string): Promise<void> {
  const specSource = source ?? resolveSpecSource();
  const start = Date.now();
  process.stderr.write(`[codegen] fetching spec: ${specSource}\n`);
  const spec = await fetchSpec(specSource);
  process.stderr.write(`[codegen] parsed ${Object.keys(spec.paths).length} paths\n`);

  const parsed = parseSpec(spec);

  mkdirSync(GENERATED_DIR, { recursive: true });

  const typesContent = generateTypes(parsed);
  writeFileSync(join(GENERATED_DIR, 'types.ts'), typesContent, 'utf-8');
  process.stderr.write(`[codegen] wrote types.ts (${parsed.schemaNames.length} types)\n`);

  const clientContent = generateClient(parsed);
  writeFileSync(join(GENERATED_DIR, 'client.ts'), clientContent, 'utf-8');
  process.stderr.write(`[codegen] wrote client.ts (${parsed.operations.length} operations)\n`);

  const commandMetaContent = generateCommandMeta(parsed);
  writeFileSync(join(GENERATED_DIR, 'commands.ts'), commandMetaContent, 'utf-8');
  process.stderr.write(`[codegen] wrote commands.ts\n`);

  // Create an index.ts for convenient imports
  const indexContent = `// Auto-generated
/* eslint-disable */
export * from './client';
export * as T from './types';
export * from './commands';
`;
  writeFileSync(join(GENERATED_DIR, 'index.ts'), indexContent, 'utf-8');

  const elapsed = Date.now() - start;
  process.stderr.write(`[codegen] done in ${elapsed}ms\n`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  generateAll().catch((err: Error) => {
    process.stderr.write(`[codegen] error: ${err.message}\n`);
    process.exit(1);
  });
}
