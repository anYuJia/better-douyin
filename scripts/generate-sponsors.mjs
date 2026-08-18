#!/usr/bin/env node
// 生成 docs/community/sponsors.png —— 赞助排行榜图片
//
// 数据来源：docs/community/sponsors.yaml（手工维护，按金额从高到低）
// 渲染依赖：macOS 自带的 qlmanage（QuickLook 引擎），把 SVG 转成 PNG，无第三方依赖。
//
// 用法：
//   node scripts/generate-sponsors.mjs
//
// 其他平台（Linux / Windows）没有 qlmanage，可换成 rsvg-convert / magick 等，见下方 SVG_EXPORTER。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'docs/community/sponsors.yaml');
const OUT_DIR = join(ROOT, 'docs/community');
const OUT_SVG = join(OUT_DIR, 'sponsors.svg');
const OUT_PNG = join(OUT_DIR, 'sponsors.png');

// ---------- YAML 极简解析（只吃本项目数据：顶层 "- name/amount/avatar_bg"） ----------
function parseSponsors(raw) {
  const rows = [];
  let cur = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('- ')) {
      // 新条目
      cur = {};
      rows.push(cur);
      const rest = trimmed.slice(2).trim();
      const m = rest.match(/^([\w_]+):\s*(.*)$/);
      if (m) {
        const [, key, valRaw] = m;
        const val = valRaw.replace(/^["']|["']$/g, '');
        if (key === 'amount') cur.amount = Number(val);
        else cur[key] = val;
      }
    } else if (cur) {
      const m = trimmed.match(/^([\w_]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, valRaw] = m;
      const val = valRaw.replace(/^["']|["']$/g, '');
      if (key === 'amount') cur.amount = Number(val);
      else cur[key] = val;
    }
  }
  return rows.filter(r => r && r.name);
}

function avatarColor(name) {
  const palette = ['#5c6bc0', '#26a69a', '#ef5350', '#8d6e63', '#78909c', '#ab47bc', '#546e7a', '#ec407a', '#ffa726', '#66bb6a'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 997;
  return palette[h % palette.length];
}

function initialOf(name) {
  // 中文取第一个字，英文取首字母；多字符到时只保留最前一个可见字符
  return Array.from(name.trim())[0] || '?';
}

const GIFTS = ['🥇', '🥈', '🥉']; // 前三名奖牌

function medalColor(index) {
  return ['#f9a825', '#90a4ae', '#e2896a'][index] || '';
}

// ---------- 渲染成 SVG ----------
function buildSvg(sponsors) {
  const COLS = 4;
  const CARD_W = 158;
  const CARD_H = 150;
  const GAP = 10;
  const PAD_X = 20;
  const HEADER_H = 64;

  const rows = Math.max(1, Math.ceil(sponsors.length / COLS));
  const width = PAD_X * 2 + COLS * CARD_W + (COLS - 1) * GAP;
  const height = HEADER_H + rows * CARD_H + (rows - 1) * GAP + PAD_X;
  const innerTop = HEADER_H + PAD_X;

  const cards = sponsors.map((s, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD_X + col * (CARD_W + GAP);
    const y = innerTop + row * (CARD_H + GAP);
    const bgColor = s.avatar_bg || avatarColor(s.name);
    const initial = initialOf(s.name);
    const isTop = i < 3;
    const medalChar = GIFTS[i];

    let glass = '';
    if (isTop) {
      const mc = medalColor(i);
      glass = `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="10" fill="${mc}" opacity="0.12"/>`;
    }
    const medal = isTop
      ? `<text x="${x + CARD_W / 2}" y="${y + 26}" font-size="26" text-anchor="middle">${medalChar}</text>`
      : `<text x="${x + 14}" y="${y + 24}" font-size="16" font-weight="bold" fill="#b6bdc6">${i + 1}</text>`;

    return `<g>
      ${glass}
      <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="10" fill="#ffffff" stroke="rgba(27,31,36,0.12)" stroke-width="1.2"/>
      ${medal}
      <circle cx="${x + CARD_W / 2}" cy="${y + 62}" r="26" fill="${bgColor}"/>
      <text x="${x + CARD_W / 2}" y="${y + 70}" font-size="26" fill="#ffffff" font-weight="700" text-anchor="middle" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${initial}</text>
      <text x="${x + CARD_W / 2}" y="${y + CARD_H - 38}" font-size="15" font-weight="600" fill="#24292f" text-anchor="middle" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${escapeXml(s.name)}</text>
      <text x="${x + CARD_W / 2}" y="${y + CARD_H - 12}" font-size="14" font-weight="700" fill="#d73a49" text-anchor="middle" font-family="Menlo, Monaco, monospace">¥ ${s.amount}</text>
    </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">
  <rect width="${width}" height="${height}" fill="#f7f8fa"/>
  <text x="${PAD_X}" y="34" font-size="22" font-weight="700" fill="#24292f">🏆 赞助排行榜</text>
  <text x="${PAD_X}" y="56" font-size="13" fill="#57606a">感谢每一位为 better-douyin 发电的伙伴 · 按赞助金额排序</text>
  ${cards.join('\n')}
</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

// ---------- SVG -> PNG（按平台选导出版本） ----------
function exporterSvgToPng(svgPath, pngPath, width) {
  if (process.platform === 'darwin') {
    // macOS：qlmanage 把 SVG 渲染成 PNG。输出目录/文件名规则：<svg目录>/<svg文件名>.png
    const dir = dirname(svgPath);
    const base = svgPath.split('/').pop();
    const res = spawnSync('qlmanage', ['-t', '-s', String(width), '-o', dir, svgPath], { encoding: 'utf8' });
    if (res.status !== 0) {
      console.error('qlmanage 失败：', res.stderr || res.stdout || '未知错误');
      process.exit(1);
    }
    // 生成的文件名 = <svg文件名>.png，挪成目标名
    const produced = join(dir, base + '.png');
    if (!existsSync(produced)) {
      console.error('qlmanage 未产出文件：', produced);
      process.exit(1);
    }
    if (produced !== pngPath) spawnSync('mv', [produced, pngPath]);
    return;
  }

  // 其他平台回退：优先 rsvg-convert，其次 ImageMagick convert
  const tryOrder = [
    { cmd: 'rsvg-convert', args: ['-w', String(width), svgPath, '-o', pngPath] },
    { cmd: 'convert', args: ['-background', 'none', '-density', '192', svgPath, pngPath] },
  ];
  for (const t of tryOrder) {
    const r = spawnSync(t.cmd, t.args, { encoding: 'utf8' });
    if (r.status === 0 && existsSync(pngPath)) return;
  }
  console.error('未找到可用的 SVG 转 PNG 工具（需要 rsvg-convert 或 ImageMagick）。已保留 sponsors.svg。');
  process.exit(1);
}

// ---------- 主流程 ----------
function main() {
  const raw = readFileSync(DATA, 'utf8');
  const sponsors = parseSponsors(raw);
  if (!sponsors.length) {
    console.error(`没有解析到赞助人，请检查 ${DATA}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const svg = buildSvg(sponsors);
  writeFileSync(OUT_SVG, svg, 'utf8');

  const pngWidth = 2 * 20 + 4 * 158 + 3 * 10; // 与 SVG width 一致
  exporterSvgToPng(OUT_SVG, OUT_PNG, pngWidth);

  console.log(`✅ 生成完成：${sponsors.length} 位赞助人`);
  console.log(`   sponsors.svg  -> ${OUT_SVG}`);
  console.log(`   sponsors.png  -> ${OUT_PNG}`);
}

main();