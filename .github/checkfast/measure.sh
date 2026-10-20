# Cold vs warm `check` through the real bin, 6 fixtures; then the warm process tests (orphan proofs) on this OS.
set -u
OUT=checkfast-out; mkdir -p $OUT/runs
BIN="node packages/cli/bin/hyperframes.mjs"
$BIN browser ensure > /dev/null 2>&1
FX="packages/producer/tests/fast-capture-gsap/src packages/producer/tests/chat/src registry/examples/decision-tree registry/examples/product-promo packages/producer/tests/heygen-promo-preview-assets/src registry/examples/kinetic-type"
W=$RUNNER_TEMP/cf-fx; mkdir -p $W
ms() { node -e 'console.log(Date.now())'; }
for src in $FX; do
  fx=$(basename $src); [ $fx = src ] && fx=$(basename $(dirname $src))
  D=$W/$fx; cp -r $src $D
  CI= $BIN check $D --json > /dev/null 2>&1   # first run: compile cache, proxy cache, spawns the warm process
  for i in 1 2 3; do
    s=$(ms); CI=1 $BIN check $D --json > $OUT/runs/$fx-cold$i.json 2>/dev/null; e=$(ms); echo "$fx cold$i $((e-s))" | tee -a $OUT/summary.txt
    CI= $BIN check $D --json > /dev/null 2>&1; sleep 3   # leaves a ready warm process behind
    s=$(ms); CI= $BIN check $D --json > $OUT/runs/$fx-warm$i.json 2>/dev/null; e=$(ms); echo "$fx warm$i $((e-s))" | tee -a $OUT/summary.txt
    sleep 3
  done
done
if [ "$RUNNER_OS" != "Windows" ]; then
  Z=$(pgrep -f dist/warmCheck.js | head -1)
  if [ -n "$Z" ]; then
    ps -A -o pid=,ppid=,rss= | awk -v r=$Z '{p[$1]=$2; m[$1]=$3} END {for (k in p) {x=k; while (x>1 && x!=r) x=p[x]; if (x==r) t+=m[k]} print "idle warm process tree RSS MB: " int(t/1024)}' | tee -a $OUT/summary.txt
  fi
fi
cd packages/cli && npx vitest run src/warmCheck.process.test.ts --maxWorkers=1 2>&1 | tee ../../$OUT/warm-tests.txt | grep -E "✓|×|Tests "
