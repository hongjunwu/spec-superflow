import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readPlan, validatePlan } from './execution-plan.mjs';
import { recordTechnicalConflict } from './technical-conflicts.mjs';
import { validateTechnicalChange } from './technical-validation.mjs';

export function run(args, io = { stdout: process.stdout, stderr: process.stderr }) {
  const { positionals, values } = parseArgs({
    args,
    options: {
      task: { type: 'string' }, summary: { type: 'string' }, affected: { type: 'string' },
      why: { type: 'string' }, next: { type: 'string' },
      json: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (values.help || positionals.length === 0) return usage(io, 0);
  const [area, action, directory] = positionals;
  if (area !== 'conflict' || action !== 'record' || !directory) return usage(io, 2);
  const changeDir = resolve(directory);
  const plan = readPlan(changeDir);
  if (!plan) throw new Error('Technical conflict recording requires an execution plan');
  const planValidation = validatePlan(changeDir, plan);
  if (!planValidation.valid) throw new Error(`Technical conflict recording requires a valid execution plan: ${planValidation.failures.join('; ')}`);
  const affected = parseAffected(values.affected);
  const record = recordTechnicalConflict(changeDir, plan, {
    taskId: values.task, summary: values.summary, why: values.why, affected, next: values.next,
  });
  if (values.json) io.stdout.write(`${JSON.stringify({ ok: true, conflict: record }, null, 2)}\n`);
  else io.stdout.write(`Technical conflict recorded for task ${record.task_id}: ${record.path}\n`);
  return { exitCode: 0 };
}

function parseAffected(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('--affected requires one or more comma-separated traceability ids');
  return value.split(',').map(id => id.trim()).filter(Boolean);
}

function usage(io, code) {
  io.stderr.write('Usage: ssf technical conflict record <change-dir> --task <id> --summary <text> --affected <id,...> --why <text> --next <text> [--json]\n');
  return { exitCode: code };
}
