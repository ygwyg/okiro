# okiro

Spawn parallel AI coding variations. Compare results. Promote the best.

## What is this?

AI agents don't always get it right the first time. okiro lets you run multiple agents on the same task, see their different approaches, and pick the winner.

```bash
okiro 3 --prompt "add dark mode" --run
# Creates 3 variations, launches AI agents in each
# Compare results, promote the best one
```

## Install

```bash
npm install -g okiro
```

Requires Node.js 18+.

## Quick Start

```bash
# Create 3 variations and run AI agents
okiro 3 --prompt "add user auth" --run

# Compare changes visually
okiro compare

# Let AI judge the variations
okiro judge

# Promote the winner
okiro promote var-1
```

## Commands

| Command | Description |
|---------|-------------|
| `okiro <n>` | Create n variations |
| `okiro status` | Show active variations |
| `okiro compare` | Open visual diff viewer |
| `okiro judge` | AI-powered ranking |
| `okiro diff var-1` | CLI diff vs original |
| `okiro promote var-1` | Apply changes to original |
| `okiro cleanup` | Remove all variations |

## Options

### Creating Variations

```bash
okiro 3                              # Basic: create 3 copies
okiro 3 --prompt                     # Prompt for direction per variation
okiro 3 --prompt "add auth"          # Set base task + per-variation directions
okiro 3 --prompt "add auth" --run    # Auto-run AI agents
```

### AI Agent Options

```bash
--run              # Auto-detect: claude > opencode > codex
--run=claude       # Force Claude Code
--run=opencode     # Force OpenCode
--run=codex        # Force Codex
--model opus       # Use specific model for all
--model            # Prompt for model per variation
```

### Other Options

```bash
-f, --force        # Replace existing variations
--no-terminal      # Don't open terminal sessions
-c, --commit       # Git commit after promote
```

## How It Works

1. **Zero-cost clones** - Uses APFS (macOS) or btrfs (Linux) for instant copies that share disk space until modified.

2. **Isolated workspaces** - Each variation lives at `~/.okiro/<project>/var-N/`. Your original is never touched.

3. **Smart diffing** - Ignores `node_modules`, `.git`, `dist`, etc.

4. **AI-powered judging** - Analyzes each file across variations and synthesizes a final ranking.

## Example Workflow

```bash
cd my-app
okiro 3 --prompt "add user auth" --run

# Terminals open with AI agents working...
# When done:

okiro compare          # Visual comparison
okiro judge            # AI ranking

okiro promote var-2 -c "feat: add auth"
okiro cleanup
```

## Docs

- [Getting Started](./docs/getting-started.md)
- [Command Reference](./docs/commands.md)
- [Advanced Usage](./docs/advanced.md)
- [How It Works](./docs/how-it-works.md)

## License

MIT
