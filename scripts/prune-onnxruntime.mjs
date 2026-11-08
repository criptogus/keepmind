#!/usr/bin/env node
// Prune onnxruntime-node native binaries to a single platform before
// electron-builder packs node_modules/** — the package ships ~294MB of
// darwin/linux/win32 × arm64/x64 binaries; a macOS build only needs ~87MB.
//
// Non-target platforms are MOVED to .onnx-stash/ (outside the packaged
// file set) and restored on the next run, so switching targets is safe.
//
// Usage: node scripts/prune-onnxruntime.mjs <darwin|win32|linux>

import { existsSync, mkdirSync, renameSync, readdirSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2]
if (!['darwin', 'win32', 'linux'].includes(target)) {
  console.error('usage: node scripts/prune-onnxruntime.mjs <darwin|win32|linux>')
  process.exit(1)
}

const binDir = join('node_modules', 'onnxruntime-node', 'bin', 'napi-v6')
const stash = join('.onnx-stash', 'napi-v6')

if (!existsSync(binDir)) {
  console.log('onnxruntime-node not installed — nothing to prune')
  process.exit(0)
}

// restore any previously stashed platforms first
if (existsSync(stash)) {
  for (const plat of readdirSync(stash)) {
    for (const arch of readdirSync(join(stash, plat))) {
      mkdirSync(join(binDir, plat), { recursive: true })
      renameSync(join(stash, plat, arch), join(binDir, plat, arch))
    }
    try { rmdirSync(join(stash, plat)) } catch {}
  }
  try { rmdirSync(stash) } catch {}
}

// move non-target platforms aside
for (const plat of readdirSync(binDir)) {
  if (plat === target) continue
  for (const arch of readdirSync(join(binDir, plat))) {
    mkdirSync(join(stash, plat), { recursive: true })
    renameSync(join(binDir, plat, arch), join(stash, plat, arch))
  }
  try { rmdirSync(join(binDir, plat)) } catch {}
}

console.log(`onnxruntime-node pruned to ${target}`)
