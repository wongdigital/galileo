---
title: "Capacitor config must stay JSON while Galileo uses TypeScript 7"
type: convention
date: 2026-07-22
unit: U10
requirements: [R1]
---

Capacitor CLI 8.4.2 loads `capacitor.config.ts` through TypeScript's legacy
programmatic API (`ModuleKind`, `ModuleResolutionKind`, and `transpileModule`).
Galileo's TypeScript 7 package intentionally exposes the compiler CLI and new
unstable APIs instead, so every Capacitor command crashes before reading a
TypeScript config.

Keep the equivalent configuration in `capacitor.config.json`. Do not downgrade
the application compiler or patch `node_modules` just to regain the optional
TypeScript config format. Revisit this when Capacitor's CLI supports the
TypeScript 7 API.
