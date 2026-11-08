# Vendored: laya-ts (TypeScript runtime for Laya)

Source: https://github.com/NandhaKishorM/laya/tree/main/laya-ts (Apache-2.0, see LICENSE.laya)
Snapshot: main @ 2026-11-07. Not yet published to npm — vendored so the app
stays self-contained.

## Local patches (keep in sync with upstream)

- `providers.ts`: added `alignFeeds()` — tolerates community ONNX exports
  whose head input is named `hidden` (official: `hidden_states`) and whose
  tensor ranks differ (e.g. `qtype` `[b]` vs `[b,1]`). Required for the
  `nvkudva/laya-onnx-q8` checkpoint used by `services/laya.ts`.

## Model

`LayaService` downloads a split-ONNX int8 export (~520MB) to
`<userData>/laya/` on demand. Files are renamed on download
(`encoder_q8.onnx` → `encoder.onnx`, `head_q8.onnx` → `head.onnx`) while the
external `.data` files keep their original names referenced inside the
graphs.
