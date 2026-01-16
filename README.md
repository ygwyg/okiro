# okiro
起きろ

Spawn ephemeral, parallel variations of your codebase. Let multiple AI agents tackle the same task, compare results, promote the best.

## Why?

AI agents don't always get it right the first time.
okiro lets you see multiple real implementations before choosing which one belongs in your codebase.

## What is this exactly?

okiro creates isolated workspaces so tools like Cursor, Claude Code, OpenCode, Codex, or any other agent can work independently in parallel without touching your main codebase.

Think of it as cheap, disposable branches that are easy to diff and easy to throw away.

## Install

```bash
npm install -g okiro
```

## Usage

### Create variations

```bash
okiro 3                    # Create 3 copies of your codebase
okiro 3 --prompt           # Create 3, prompt for direction per variation
okiro 3 --prompt "add dark mode"  # Base task + per-variation directions
```

When using `--prompt`, okiro writes instructions to `AGENTS.md` and `.cursor/rules` so AI agents in each workspace know their specific approach.

### Auto-run AI agents

```bash
okiro 3 --prompt "add auth" --run        # Auto-detect and run claude/opencode/codex
okiro 3 --prompt "add auth" --run=claude # Force Claude Code
okiro 3 --prompt "add auth" --run=opencode
okiro 3 --prompt "add auth" --run=codex
```

With `--run`, okiro opens terminals and automatically starts the AI agent in each variation. If none are installed, terminals open normally.

### Compare changes

```bash
okiro compare              # Open diff viewer in browser
okiro diff var-1           # CLI diff: original vs var-1
okiro diff var-1 var-2     # CLI diff: var-1 vs var-2
```

### Pick a winner

```bash
okiro promote var-2        # Apply var-2's changes to original
okiro promote var-2 -c     # Promote and git commit
okiro promote var-2 -c "feat: dark mode using Tailwind"
```

### Cleanup

```bash
okiro status               # Show active variations
okiro cleanup              # Remove all variation workspaces
```

## How it works

1. **Zero-cost clones** — Uses APFS clones on macOS and btrfs reflinks on Linux. 100 clones of a 10GB project still uses ~10GB on disk—they share the same blocks until modified. Only changed files allocate new space.

2. **Isolated workspaces** — Each variation is a full copy at `~/.okiro/<project>/var-N/`. Open them in separate editor windows, run different agents, go wild.

3. **Smart diffing** — Only tracks meaningful changes, ignoring `node_modules`, `.git`, `dist`, etc.

4. **Non-destructive** — Your original codebase is never touched until you explicitly `promote`.

## Example workflow

```bash
# You want to add authentication but aren't sure about the approach
cd my-app
okiro 3 --prompt "add user authentication" --run

# Enter directions when prompted:
#   var-1: use Better Auth
#   var-2: use Clerk
#   var-3: roll our own with JWT + cookies

# Terminals open with AI agents already running in each variation
# Watch them cook...

# Compare results
okiro compare

# var-1 looks cleanest, promote it
okiro promote var-1 -c "feat: add auth via Better Auth"

# Clean up
okiro cleanup
```

## License

MIT
