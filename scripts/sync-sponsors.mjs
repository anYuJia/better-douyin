#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSponsors } from './sponsors-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'docs/community/sponsors.md');
const README = join(ROOT, 'README.md');
const START = '<!-- SPONSORS:START -->';
const END = '<!-- SPONSORS:END -->';

function formatAmount(amount) {
  return Number.isInteger(amount) ? amount.toLocaleString('en-US') : String(amount);
}

function buildReadmeBlock(sponsors) {
  const rows = sponsors.map((sponsor, index) => {
    const name = sponsor.name.replaceAll('|', '\\\\|').replaceAll('\n', ' ');
    return '| ' + (index + 1) + ' | ' + name + ' | ¥ ' + formatAmount(sponsor.amount) + ' |';
  });

  return [
    START,
    '| 排名 | 赞助人 | 累计赞助 |',
    '| ---: | :--- | ---: |',
    ...rows,
    END,
  ].join('\n');
}

function main() {
  const sponsors = readSponsors(SOURCE);
  const readme = readFileSync(README, 'utf8');
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);

  if (start < 0 || end < start) {
    throw new Error('README.md 中没有找到赞助名单同步标记');
  }

  const block = buildReadmeBlock(sponsors);
  const nextReadme = readme.slice(0, start) + block + readme.slice(end + END.length);
  writeFileSync(README, nextReadme, 'utf8');
  console.log('已同步 ' + sponsors.length + ' 位赞助人到 README.md');
}

main();
