# okiro
起きろ

Spawn ephemeral, parallel variations of your codebase. Let multiple AI agents tackle the same task, compare results, promote the best.

## Why?

AI agents don’t always get it right the first time.
okiro lets you see multiple real implementations before choosing which one belongs in your codebase.

## What is this exactly?

okiro does not run AI agents for you.

It creates isolated workspaces so tools like Cursor, Claude, Codex, or any other agent can work independently in parallel without touching your main codebase.

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

1. **Efficient cloning** — Uses APFS clones on macOS and btrfs reflinks on Linux for instant, space-efficient copies. Falls back to rsync elsewhere.

2. **Isolated workspaces** — Each variation is a full copy at `~/.okiro/<project>/var-N/`. Open them in separate editor windows, run different agents, go wild.

3. **Smart diffing** — Only tracks meaningful changes, ignoring `node_modules`, `.git`, `dist`, etc.

4. **Non-destructive** — Your original codebase is never touched until you explicitly `promote`.

## Example workflow

```bash
# You want to add authentication but aren't sure about the approach
cd my-app
okiro 3 --prompt "add user authentication"

# Enter directions when prompted:
#   var-1: use Better Auth
#   var-2: use Clerk
#   var-3: roll our own with JWT + cookies

# Open each variation in a separate Cursor window
# Let the AI agents cook...

# Compare results
okiro compare

# var-1 looks cleanest, promote it
okiro promote var-1 -c "feat: add auth via Better Auth"

# Clean up
okiro cleanup
```

## License

MIT
