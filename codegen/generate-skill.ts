import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function generateSkill(): string {
  const skillPath = join(process.cwd(), 'skill', 'SKILL.md');
  const content = readFileSync(skillPath, 'utf-8');
  return `// Auto-generated from skill/SKILL.md — do not edit
/* eslint-disable */
export const SKILL_MD = ${JSON.stringify(content)};
`;
}
