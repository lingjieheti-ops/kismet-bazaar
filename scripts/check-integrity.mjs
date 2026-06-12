#!/usr/bin/env node
// KISMET integrity gate.
//
// Scans every tracked text file for reviewer-manipulation vectors:
//   1. invisible characters (zero-width, BOM-in-body, bidi controls)
//   2. prompt-injection phrases aimed at AI-assisted judging
//   3. hidden-text styling in HTML/Markdown (white-on-white, sub-2pt fonts)
//
// KISMET is judged partly by machines. This gate is our standing claim that
// nothing in this repository whispers to them. It runs in CI on every push;
// a finding fails the build.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const SKIP_DIRS = new Set([
  ".git", "node_modules", "target", ".next", "dist", "wasm", "resources",
]);
const TEXT_EXT = new Set([
  ".rs", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".toml", ".yml",
  ".yaml", ".md", ".txt", ".html", ".css", ".svg", ".sh", ".ps1", ".env",
]);

const INVISIBLES = [
  { re: /[​‌‍⁠⁡⁢⁣⁤]/g, label: "zero-width character" },
  { re: /[‪-‮⁦-⁩]/g, label: "bidi control character" },
  { re: /﻿(?!^)/g, label: "BOM inside file body" },
];

const INJECTION_PHRASES = [
  { re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/i, label: "instruction-override phrase" },
  { re: /disregard\s+(all\s+)?(previous|prior|your)\s+(instructions|guidelines)/i, label: "instruction-override phrase" },
  { re: /give\s+(this|the)\s+(project|submission|buidl|paper|repo)\s+a\s+(positive|high|perfect|good)/i, label: "score-coercion phrase" },
  { re: /recommend\s+(accept(ance)?|this\s+project\s+for\s+(the\s+)?(prize|award|win))/i, label: "score-coercion phrase" },
  { re: /rate\s+(this|it)\s+(a\s+)?(5|five|10|ten|highly)/i, label: "score-coercion phrase" },
  { re: /do\s+not\s+(find|report|mention)\s+(any\s+)?(weakness|flaw|issue)/i, label: "review-suppression phrase" },
  { re: /you\s+are\s+(now\s+)?(grading|judging|reviewing)\b.{0,40}\b(favorably|positively)/i, label: "reviewer-steering phrase" },
];

const HIDDEN_STYLE = [
  { re: /color\s*:\s*(#fff(fff)?|white|rgba?\(\s*255\s*,\s*255\s*,\s*255)/i, label: "white text styling", onlyIn: [".html", ".md", ".svg"] },
  { re: /font-size\s*:\s*(0(\.\d+)?|1)(px|pt)/i, label: "sub-2pt font styling", onlyIn: [".html", ".md", ".svg", ".css"] },
];

let findings = 0;

function scanFile(path) {
  const ext = extname(path).toLowerCase();
  if (!TEXT_EXT.has(ext)) return;
  // This file teaches the patterns; it may name them.
  if (path.endsWith("check-integrity.mjs")) return;
  const body = readFileSync(path, "utf8");

  for (const { re, label } of INVISIBLES) {
    const m = body.match(re);
    if (m) report(path, label, `${m.length} occurrence(s)`);
  }
  for (const { re, label } of INJECTION_PHRASES) {
    const m = body.match(re);
    if (m) report(path, label, JSON.stringify(m[0].slice(0, 80)));
  }
  for (const { re, label, onlyIn } of HIDDEN_STYLE) {
    if (!onlyIn.includes(ext)) continue;
    const m = body.match(re);
    if (m) report(path, label, JSON.stringify(m[0].slice(0, 80)));
  }
}

function report(path, label, detail) {
  findings += 1;
  console.error(`INTEGRITY: ${label} in ${path}: ${detail}`);
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path);
    } else {
      scanFile(path);
    }
  }
}

walk(ROOT);

if (findings > 0) {
  console.error(`\nintegrity gate: ${findings} finding(s). Build fails.`);
  process.exit(1);
}
console.log("integrity gate: clean. No invisible characters, no injection phrases, no hidden styling.");
