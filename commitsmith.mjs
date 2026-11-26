#!/usr/bin/env node
/**
 * commitsmith — commit message generator backed by a local Ollama model, Ollama
 * Cloud, OpenAI, Anthropic, or any OpenAI-compatible endpoint.
 *
 * This file is just the executable entry point. All logic lives under ./src —
 * see src/cli.mjs for the top-level dispatch, or run `commitsmith --help` /
 * read README.md for usage, providers, env vars, and the config file format.
 *
 * Copyright (c) Munywele Consulting LTD
 * https://munywele.co.ke
 */

import { run } from './src/cli.mjs';

process.on('unhandledRejection', (err) => {
  console.error('Unexpected error:', err?.message || err);
  process.exit(1);
});

run();
