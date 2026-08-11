#!/usr/bin/env bun
import { $ } from "bun"

const env = { ...process.env, OPENCODE_CHANNEL: "prod" }

await $`bun run build`.env(env)
await $`bun run package:win`.env(env)
