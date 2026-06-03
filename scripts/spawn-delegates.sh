#!/bin/bash
# spawn_delegates.sh - Spawn parallel Owl-Alpha Hermes delegates
# Each delegate uses the credential pool automatically (4 OpenRouter keys)
# Usage: ./spawn_delegates.sh "task description" [suffix]

TASK="$1"
SUFFIX="${2:-delegate}"
TIMESTAMP=$(date +%s)
OUTDIR="/home/ryano/projects/agenttrace/.delegates"
mkdir -p "$OUTDIR"

# Spawn a single delegate in background
spawn_one() {
    local id="$1"
    local task="$2"
    local outfile="$OUTDIR/${TIMESTAMP}_${id}.txt"
    
    # Use hermes chat in quiet mode with file tools enabled
    # Credential pool auto-rotates through 4 OpenRouter keys
    hermes chat -q "$task" \
        --model "openrouter/owl-alpha" \
        --toolsets "terminal,file,web" \
        --max-turns 50 \
        -Q \
        > "$outfile" 2>&1 &
    
    echo "Spawned delegate $id (PID $!) -> $outfile"
    
    # Small delay to stagger API key usage
    sleep 2
}

# Spawn N delegates
N="${3:-4}"
for i in $(seq 1 $N); do
    spawn_one "${SUFFIX}_${i}" "$TASK"
done

echo "Spawned $N delegates. Check $OUTDIR for results."
echo "Monitor with: tail -f $OUTDIR/*.txt"
