import { readFile, writeFile } from 'fs/promises';
import type { Stats } from 'fs';
import defaultThing, { helper } from './helper';
import * as path from 'path';
import { Config } from './config';

// eslint-disable-next-line no-console
export const cfg: Config = { helper: 1 };

export async function load(file: string): Promise<Stats | null> {
  const data = await readFile(file, 'utf8');
  const obj = { path: data };
  return obj.path ? null : null;
}

export function other() {
  throw new Error('x');
  console.log('após throw');
}
