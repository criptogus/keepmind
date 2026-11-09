#!/usr/bin/env node
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
try {
  const { runCli } = require('../out/main/cli.js')
  process.stdout.write(JSON.stringify(await runCli(), null, 2) + '\n')
} catch {
  process.stderr.write('KeepMind command failed. Check the command, directories, build, and encryption unlock.\n')
  process.exitCode = 1
}
