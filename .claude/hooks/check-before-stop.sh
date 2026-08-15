#!/bin/bash
INPUT=$(cat)

# Évite la boucle infinie sur le même tour
if echo "$INPUT" | grep -q '"stop_hook_active":true'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0
FAILURES=""

# 1. TypeScript
TSC_OUTPUT=$(npx tsc --noEmit 2>&1)
if [ $? -ne 0 ]; then
  FAILURES="${FAILURES}--- Erreurs TypeScript (tsc --noEmit) ---\n${TSC_OUTPUT}\n\n"
fi

# 2. Tests Python (pytest) - uniquement si le projet a reellement une suite pytest
# (ce depot est TypeScript/Electron ; "tests/" contient des specs .ts, pas du Python)
if [ -f "pytest.ini" ] || [ -f "pyproject.toml" ]; then
  PYTEST_OUTPUT=$(python -m pytest -x -q 2>&1)
  if [ $? -ne 0 ]; then
    FAILURES="${FAILURES}--- Tests Python en échec (pytest) ---\n${PYTEST_OUTPUT}\n\n"
  fi
fi

# 3. Playwright e2e - seulement si des fichiers sensibles ont changé
CHANGED=$(git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached HEAD 2>/dev/null)
if echo "$CHANGED" | grep -qE '^(src/main/|e2e/|src/preload/)'; then
  E2E_OUTPUT=$(env -u ELECTRON_RUN_AS_NODE npx playwright test 2>&1)
  if [ $? -ne 0 ]; then
    FAILURES="${FAILURES}--- Tests Playwright e2e en échec ---\n${E2E_OUTPUT}\n\n"
  fi
fi

if [ -n "$FAILURES" ]; then
  echo -e "Des vérifications ont échoué avant de terminer :\n\n${FAILURES}Corrige ces problèmes avant de conclure." >&2
  exit 2
fi

exit 0