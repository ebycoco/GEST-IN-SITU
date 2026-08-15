#!/bin/bash
cd "$CLAUDE_PROJECT_DIR" || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
STATUS=$(git status --short 2>/dev/null)
CHANGES=$(echo "$STATUS" | grep -c . 2>/dev/null)
LAST_COMMIT=$(git log -1 --oneline 2>/dev/null)

if [ -z "$BRANCH" ]; then
  exit 0
fi

CONTEXT=$(cat <<EOF
Contexte git du projet :
- Branche courante : $BRANCH
- Dernier commit : $LAST_COMMIT
- Fichiers modifiés non commités : $CHANGES
$( [ "$CHANGES" -gt 0 ] && echo "$STATUS" )
EOF
)

python3 -c "
import json
print(json.dumps({
  'hookSpecificOutput': {
    'hookEventName': 'SessionStart',
    'additionalContext': '''$CONTEXT'''
  }
}))
" 2>/dev/null || echo "$CONTEXT"