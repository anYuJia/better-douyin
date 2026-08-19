import { readFileSync } from 'node:fs';

function splitRow(line) {
  const cells = [];
  let cell = '';
  let escaped = false;

  for (const char of line.trim()) {
    if (char === '|' && !escaped) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    if (char === '\\' && !escaped) {
      escaped = true;
      cell += char;
      continue;
    }
    escaped = false;
    cell += char;
  }

  cells.push(cell.trim());
  if (cells[0] === '') cells.shift();
  if (cells.at(-1) === '') cells.pop();
  return cells.map((value) => value.replace(/\\\|/g, '|').trim());
}

function isTableSeparator(line) {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function cleanCell(value) {
  return value.replace(/^`|`$/g, '').trim();
}

export function parseSponsorsMarkdown(raw) {
  const lines = raw.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    if (!line.includes('|')) return false;
    return splitRow(line).some((cell) => cleanCell(cell) === '赞助人');
  });

  if (headerIndex < 0 || !isTableSeparator(lines[headerIndex + 1] || '')) {
    throw new Error('sponsors.md 中没有找到有效的赞助名单表格');
  }

  const headers = splitRow(lines[headerIndex]).map(cleanCell);
  const nameIndex = headers.indexOf('赞助人');
  const amountIndex = headers.findIndex((header) => header.startsWith('累计赞助') || header === '金额');
  const colorIndex = headers.findIndex((header) => header.startsWith('头像背景色'));

  if (nameIndex < 0 || amountIndex < 0) {
    throw new Error('赞助名单表格必须包含“赞助人”和“累计赞助”列');
  }

  const sponsors = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith('|')) break;
    const cells = splitRow(line);
    const name = cleanCell(cells[nameIndex] || '');
    const amountText = cleanCell(cells[amountIndex] || '').replace(/[￥¥,，\s元]/g, '');
    const amount = Number(amountText);

    if (!name && !amountText) continue;
    if (!name || !Number.isFinite(amount) || amount < 0) {
      throw new Error('赞助名单中存在无效数据：' + line);
    }

    sponsors.push({
      name,
      amount,
      avatar_bg: cleanCell(cells[colorIndex] || ''),
      sourceIndex: sponsors.length,
    });
  }

  if (!sponsors.length) throw new Error('赞助名单表格为空');

  return sponsors
    .sort((a, b) => b.amount - a.amount || a.sourceIndex - b.sourceIndex)
    .map(({ sourceIndex, ...sponsor }) => sponsor);
}

export function readSponsors(filePath) {
  return parseSponsorsMarkdown(readFileSync(filePath, 'utf8'));
}
