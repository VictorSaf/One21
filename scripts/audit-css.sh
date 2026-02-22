#!/usr/bin/env bash
# ============================================================
# ONE21 — CSS Design System Audit Script
# Detectează violări ale sistemului de design.
# Usage: bash scripts/audit-css.sh
# Exit code 0 = tot ok, 1 = violări găsite
# ============================================================

set -euo pipefail

ERRORS=0
WARNINGS=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "═══════════════════════════════════════════════"
echo " ONE21 CSS Design System Audit"
echo "═══════════════════════════════════════════════"

# ── 1. Verifică că nu există <style> embedded în HTML ──
echo ""
echo "▶ [1/4] Checking for embedded <style> tags in HTML files..."
for file in "$PROJECT_DIR"/public/*.html; do
  [[ "$(basename $file)" == "showcase.html" ]] && continue
  [[ "$(basename $file)" == "model-comparison.html" ]] && continue
  count=$(grep -c "<style>" "$file" 2>/dev/null || true); count=${count:-0}
  if [ "$count" -gt 0 ]; then
    echo "  ✗ FAIL: $file contains $count embedded <style> block(s)"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ OK: $(basename $file)"
  fi
done

# ── 2. Verifică că nu există culori hardcodate în CSS ──
echo ""
echo "▶ [2/4] Checking for hardcoded colors in CSS layer files..."
for file in "$PROJECT_DIR"/public/css/layers/base.css "$PROJECT_DIR"/public/css/layers/components.css "$PROJECT_DIR"/public/css/layers/pages/*.css; do
  [ -f "$file" ] || continue
  results=$(grep -nE "(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))" "$file" 2>/dev/null \
    | grep -v "var(--" \
    | grep -v "^\s*/\*" \
    | grep -v "^[0-9]*:.*\/\*" \
    || true)
  if [ -n "$results" ]; then
    echo "  ✗ FAIL: $(basename $file) has hardcoded colors:"
    echo "$results" | sed 's/^/    /'
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ OK: $(basename $file)"
  fi
done

# ── 3. Verifică că nu există inline style= în HTML (warning) ──
echo ""
echo "▶ [3/4] Checking for inline style= attributes in HTML files..."
for file in "$PROJECT_DIR"/public/*.html; do
  [[ "$(basename $file)" == "showcase.html" ]] && continue
  [[ "$(basename $file)" == "model-comparison.html" ]] && continue
  count=$(grep -c ' style=' "$file" 2>/dev/null || true); count=${count:-0}
  if [ "$count" -gt 0 ]; then
    echo "  ⚠ WARN: $(basename $file) has $count inline style= attribute(s)"
    WARNINGS=$((WARNINGS + 1))
  else
    echo "  ✓ OK: $(basename $file)"
  fi
done

# ── 4. Verifică că toate paginile importă design-system.css ──
echo ""
echo "▶ [4/4] Checking that all HTML pages import design-system.css..."
for file in "$PROJECT_DIR"/public/*.html; do
  [[ "$(basename $file)" == "showcase.html" ]] && continue
  [[ "$(basename $file)" == "model-comparison.html" ]] && continue
  if grep -q "design-system.css" "$file"; then
    echo "  ✓ OK: $(basename $file)"
  else
    echo "  ✗ FAIL: $(basename $file) does not import design-system.css"
    ERRORS=$((ERRORS + 1))
  fi
done

# ── Sumar ──
echo ""
echo "═══════════════════════════════════════════════"
printf " Results: %d error(s), %d warning(s)\n" $ERRORS $WARNINGS
echo "═══════════════════════════════════════════════"

if [ "$ERRORS" -gt 0 ]; then
  echo " STATUS: FAIL ✗"
  exit 1
else
  echo " STATUS: PASS ✓"
  exit 0
fi
