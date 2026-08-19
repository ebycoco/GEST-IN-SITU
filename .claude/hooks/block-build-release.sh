#!/bin/bash
INPUT=$(cat)

if [ -z "$INPUT" ]; then
  exit 0
fi

if echo "$INPUT" | grep -qE 'npm[[:space:]]+run[[:space:]]+(build:[A-Za-z0-9_-]+|release|make)([[:space:]]|"|$)'; then
  echo "Commande bloquee par .claude/hooks/block-build-release.sh" >&2
  echo "CLAUDE.md §1 interdit a un agent de lancer npm run build:*/release/make de sa propre initiative." >&2
  echo "Seul l'utilisateur peut executer cette commande, en dehors de Claude Code." >&2
  exit 2
fi

exit 0
