#!/usr/bin/env node

/**
 * EZRA Session Dashboard Hook
 * 
 * Renders a compact project status line on every Claude Code session start.
 * Reads .ezra/ state and outputs a 3-5 line summary injected into context.
 * 
 * Install: Add to settings.json under hooks.SessionStart
 */

'use strict';

const MAX_STDIN = 1024 * 1024; // 1 MB stdin safety limit

const fs = require('fs');
const path = require('path');

// EZRA feedback helpers (non-blocking)
let _log;
try { _log = require('./ezra-hook-logger').logHookEvent; } catch { _log = () => {}; }

// Read stdin (Claude Code hook protocol)
let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  stdinData += chunk;
  if (stdinData.length > MAX_STDIN) { process.exit(0); }
});
process.stdin.on('end', () => {
  let event = {};
  try { event = JSON.parse(stdinData); } catch (_) {}
  run(event);
});

function run(event) {
  const cwd = event.cwd || process.cwd();
  const ezraDir = path.join(cwd, '.ezra');

  if (!fs.existsSync(ezraDir)) {
    console.log('EZRA: Not initialized. Run /ezra:init');
    process.exit(0);
  }

  let projectName = path.basename(cwd);
  try {
    let phase = '?';
    let protectedPaths = 0;
    const govPath = path.join(ezraDir, 'governance.yaml');
    if (fs.existsSync(govPath)) {
      const gov = fs.readFileSync(govPath, 'utf8');
      const nameMatch = gov.match(/name:\s*(.+)/);
      const phaseMatch = gov.match(/project_phase:\s*(.+)/);
      const ppMatches = gov.match(/- pattern:/g);
      if (nameMatch) projectName = nameMatch[1].trim();
      if (phaseMatch) phase = phaseMatch[1].trim();
      if (ppMatches) protectedPaths = ppMatches.length;
    }

    let decisions = 0;
    const decDir = path.join(ezraDir, 'decisions');
    if (fs.existsSync(decDir)) {
      decisions = fs.readdirSync(decDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
    }

    let lastScan = 'Never';
    let healthScore = '—';
    let critical = 0;
    let high = 0;
    const scanDir = path.join(ezraDir, 'scans');
    if (fs.existsSync(scanDir)) {
      const scans = fs.readdirSync(scanDir).filter(f => f.includes('scan') || f.includes('health')).sort((a, b) => {
        const ma = fs.statSync(path.join(scanDir, a)).mtimeMs;
        const mb = fs.statSync(path.join(scanDir, b)).mtimeMs;
        return mb - ma;
      });
      if (scans.length > 0) {
        const scanContent = fs.readFileSync(path.join(scanDir, scans[0]), 'utf8');
        const dateMatch = scanContent.match(/timestamp:\s*(.+)/);
        const healthMatch = scanContent.match(/(?:health_score|overall_score):\s*(\d+)/);
        const critMatch = scanContent.match(/critical:\s*(\d+)/);
        const highMatch = scanContent.match(/high:\s*(\d+)/);
        if (dateMatch) lastScan = dateMatch[1].trim().substring(0, 10);
        if (healthMatch) healthScore = healthMatch[1];
        if (critMatch) critical = parseInt(critMatch[1]);
        if (highMatch) high = parseInt(highMatch[1]);
      }
    }

    let docCount = 0;
    const docTotal = 81;
    let criticalGaps = 0;
    const regPath = path.join(ezraDir, 'docs', 'registry.yaml');
    if (fs.existsSync(regPath)) {
      const reg = fs.readFileSync(regPath, 'utf8');
      const totalMatch = reg.match(/total_existing:\s*(\d+)/);
      if (totalMatch) docCount = parseInt(totalMatch[1]);
      else {
        const docsSection = reg.split(/\nmissing:/)[0];
        const docMatches = docsSection.match(/- type:/g);
        if (docMatches) docCount = docMatches.length;
      }
      const critDocs = ['prd', 'tad', 'adr', 'deploy-runbook', 'go-live', 'dr-plan', 'handover'];
      for (const cd of critDocs) {
        if (!reg.includes(`type: ${cd}`)) criticalGaps++;
      }
    } else {
      criticalGaps = 7;
    }

    let activePlans = 0;
    const planDir = path.join(ezraDir, 'plans');
    if (fs.existsSync(planDir)) {
      activePlans = fs.readdirSync(planDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
    }

    let openRisks = 0;
    const riskPath = path.join(ezraDir, 'risks.yaml');
    if (fs.existsSync(riskPath)) {
      const riskContent = fs.readFileSync(riskPath, 'utf8');
      const openMatches = riskContent.match(/status:\s*OPEN/gi);
      if (openMatches) openRisks = openMatches.length;
    }

    let branch = '?';
    let uncommitted = 0;
    try {
      const { execSync } = require('child_process');
      branch = execSync('git branch --show-current', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }).trim() || '?';
      const status = execSync('git status --porcelain', { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
      uncommitted = status.split('\n').filter(l => l.trim()).length;
    } catch (_) { /* not a git repo or timeout */ }

    const healthIcon = healthScore === '—' ? '⚪' :
      parseInt(healthScore) >= 80 ? '🟢' :
      parseInt(healthScore) >= 50 ? '🟡' : '🔴';

    const findingsStr = (critical > 0 || high > 0)
      ? ` │ Findings: ${critical}C ${high}H` : '';
    const gapsStr = criticalGaps > 0
      ? ` │ Doc gaps: ${criticalGaps} critical` : '';
    const riskStr = openRisks > 0
      ? ` │ Risks: ${openRisks} open` : '';

    console.log(`═══ EZRA ═══ ${projectName} │ ${phase} │ ${healthIcon} Health: ${healthScore}/100 │ Branch: ${branch} (${uncommitted} uncommitted)`);
    console.log(`  Decisions: ${decisions} │ Docs: ${docCount}/${docTotal} │ Plans: ${activePlans}${findingsStr}${gapsStr}${riskStr}`);

    if (critical > 0) {
      console.log(`  🔴 ${critical} CRITICAL scan findings unresolved`);
    }
    if (criticalGaps > 3) {
      console.log(`  ⚠️  ${criticalGaps} critical documents missing — run /ezra:doc check`);
    }
  } catch (err) {
    const msg = `EZRA: ${projectName || 'Unknown'} │ Error reading state: ${err.message}`;
    console.log(msg);
    _log(cwd, 'ezra-dash-hook', 'warn', msg, 'Run /ezra:health to diagnose.');
  }
  process.exit(0);
}

module.exports = { run, MAX_STDIN };
