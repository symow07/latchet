#!/usr/bin/env bash
# End-to-end tests on the iOS simulator with Maestro. See e2e/README.md.
#
#   e2e/run.sh [label] [flow-number ...]
#
#   e2e/run.sh                     every flow, labelled <branch>-<date-time>
#   e2e/run.sh step2               every flow, labelled step2
#   e2e/run.sh step2 03 04         only flows 03 and 04 (01 is always run first:
#                                  it signs in on a fresh install)
#
# Needs: maestro, the local backend on http://localhost:3000 (latchet_dev),
# a booted simulator, and an app built with EXPO_PUBLIC_BACKEND_URL pointing at
# that backend (README: "Build the app under test"). Uses the E2E account from
# .claude/test-accounts.local.json (never a real account, never Gmail).
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
mobile="$(dirname "$here")"
root="$(dirname "$mobile")"
flows="$here/flows"

label="${1:-$(git -C "$root" rev-parse --abbrev-ref HEAD)-$(date +%Y%m%d-%H%M)}"
shift || true
only=("$@")

shots="$here/screenshots/$label"
output="$here/output/$label"
state="$here/.state"
# A label is one run: a rerun under the same label replaces its screenshots.
rm -rf "$shots" "$output"
mkdir -p "$shots" "$output" "$state"

backend="${E2E_BACKEND:-http://localhost:3000}"
app="${E2E_APP:-$mobile/ios/build/Build/Products/Release-iphonesimulator/Latchet.app}"
bundle="com.latchet.app"

fail() { echo "e2e: $*" >&2; exit 2; }

command -v maestro >/dev/null || fail "maestro is not installed (brew install mobile-dev-inc/tap/maestro)"
[ -d "$app" ] || fail "no app at $app (build it first, or set E2E_APP)"
curl -sf --max-time 10 "$backend/health" | grep -q '"ok"' || fail "the backend at $backend is not up (start it: cd backend && bun run dev)"

device="${E2E_DEVICE:-$(xcrun simctl list devices booted | sed -nE 's/.*\(([0-9A-F-]{36})\) \(Booted\).*/\1/p' | head -1)}"
[ -n "$device" ] || fail "no booted simulator (boot one, or set E2E_DEVICE to its UDID)"

accounts="$root/.claude/test-accounts.local.json"
E2E_EMAIL="${E2E_EMAIL:-$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['e2e']['email'])" "$accounts" 2>/dev/null)}"
E2E_PASSWORD="${E2E_PASSWORD:-$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['e2e']['password'])" "$accounts" 2>/dev/null)}"
[ -n "$E2E_EMAIL" ] && [ -n "$E2E_PASSWORD" ] || fail "no E2E account: add an \"e2e\" entry to $accounts (README)"
case "$E2E_EMAIL" in *@example.test) ;; *) fail "the E2E account must be an @example.test address on the local backend" ;; esac
E2E_RUN="$(date +%m%d-%H%M%S)"

echo "e2e: $label on $device, account $E2E_EMAIL, run $E2E_RUN"

# ── The simulator ───────────────────────────────────────────────────────────
xcrun simctl install "$device" "$app" || fail "could not install $app"
for service in photos microphone; do xcrun simctl privacy "$device" grant "$service" "$bundle" >/dev/null 2>&1; done

# The receipt photo goes into Photos once per simulator (Photos keeps it).
if [ ! -f "$state/$device.media" ]; then
  xcrun simctl addmedia "$device" "$here/fixtures/receipt.jpg" && touch "$state/$device.media"
fi

# The bank statement goes into Files › On My iPhone. Its monthly charge is
# named after this run, so every run imports something new and detection finds
# a new subscription, which is when the app asks for notification permission
# (a fresh install has none, and flow 15 needs it).
files_root="$(xcrun simctl get_app_container "$device" com.apple.DocumentsApp groups | awk '/group.com.apple.FileProvider.LocalStorage/ {print $2}')"
if [ -n "$files_root" ]; then
  mkdir -p "$files_root/File Provider Storage"
  python3 - "$here/fixtures/statement.csv" "$files_root/File Provider Storage/latchet-e2e-statement.csv" "$E2E_RUN" <<'PY'
import sys, datetime
template, target, run = sys.argv[1:4]
day = datetime.date.today() - datetime.timedelta(days=6)
def months_back(n):
    m = day.month - 1 - n
    return datetime.date(day.year + m // 12, m % 12 + 1, min(day.day, 28))
text = open(template).read().replace("{RUN}", run)
for n in range(4):
    text = text.replace("{MONTH-%d}" % n, months_back(n).strftime("%m/%d/%Y"))
open(target, "w").write(text)
PY
fi

# Enrolled biometrics, so the app offers its biometric lock.
xcrun simctl spawn "$device" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn "$device" notifyutil -p com.apple.BiometricKit.enrollmentChanged

# ── Hooks: what Maestro cannot do from inside a flow ────────────────────────
before_flow() {
  case "$1" in
    08-*)
      # The receipt, as the share extension would hand it to the app.
      local data; data="$(xcrun simctl get_app_container "$device" "$bundle" data)"
      mkdir -p "$data/Documents"
      cp "$here/fixtures/receipt.jpg" "$data/Documents/e2e-receipt.jpg"
      E2E_RECEIPT_URI="$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "file://$data/Documents/e2e-receipt.jpg")"
      ;;
  esac
}
after_flow() {
  case "$1" in
    10-*)
      # A matching face for the lock screen's Face ID prompt.
      sleep 3
      xcrun simctl spawn "$device" notifyutil -p com.apple.BiometricKit_Sim.pearl.match
      ;;
    12-*)
      # The share extension's Post, which Maestro cannot tap: the same queue
      # line and image file it writes into the App Group (ShareViewController).
      local group id
      group="$(xcrun simctl get_app_container "$device" "$bundle" group.com.latchet.app)"
      id="$(uuidgen)"
      mkdir -p "$group/shared-media"
      cp "$here/fixtures/receipt.jpg" "$group/shared-media/$id.JPG"
      printf '{"id":"%s","kind":"image","text":"","at":%s,"file":"%s.JPG"}\n' \
        "$(uuidgen)" "$(($(date +%s) * 1000))" "$id" >> "$group/pending-shares.ndjson"
      xcrun simctl terminate "$device" com.apple.mobileslideshow 2>/dev/null
      ;;
    14-*)
      # A bill reminder push, as the server sends one.
      sleep 2
      xcrun simctl push "$device" "$bundle" "$here/fixtures/bill-reminder.apns"
      ;;
  esac
}

# ── The flows ───────────────────────────────────────────────────────────────
E2E_RECEIPT_URI=""
selected() {
  local name="$1" n
  [ ${#only[@]} -eq 0 ] && return 0
  case "$name" in 01-*) return 0 ;; esac
  for n in "${only[@]}"; do case "$name" in "$n"-*) return 0 ;; esac; done
  return 1
}

passed=() failed=()
for flow in "$flows"/[0-9][0-9]-*.yaml; do
  name="$(basename "$flow" .yaml)"
  selected "$name" || continue
  before_flow "$name"
  printf 'e2e: %-34s ' "$name"
  if maestro --device "$device" test \
      -e E2E_EMAIL="$E2E_EMAIL" -e E2E_PASSWORD="$E2E_PASSWORD" \
      -e E2E_RUN="$E2E_RUN" -e E2E_RECEIPT_URI="$E2E_RECEIPT_URI" \
      --test-output-dir "$output/$name" "$flow" >"$output/$name.log" 2>&1; then
    echo "passed"; passed+=("$name")
  else
    echo "FAILED  ($(grep -E 'FAILED|Element not found|Assertion is false' "$output/$name.log" | grep -v '^Run ' | head -2 | tr '\n' ' '))"
    failed+=("$name")
  fi
  after_flow "$name"
done

# ── Screenshots in one folder ───────────────────────────────────────────────
find "$output" -path '*takeScreenshot*' -name '*.png' -exec cp {} "$shots/" \;
for name in "${failed[@]+"${failed[@]}"}"; do
  # Maestro's own screenshot of the step that failed (its last one).
  shot="$(find "$output/$name" -path '*/screenshots/*' -name '*.png' 2>/dev/null | sort | tail -1)"
  [ -n "$shot" ] && cp "$shot" "$shots/FAILED-$name.png"
done

echo
echo "e2e: ${#passed[@]} passed, ${#failed[@]} failed"
for name in "${failed[@]+"${failed[@]}"}"; do echo "  failed: $name (log: $output/$name.log)"; done
echo "e2e: screenshots in $shots"
[ ${#failed[@]} -eq 0 ]
