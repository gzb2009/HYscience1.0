---
name: slurm-hpc
description: Submit and monitor jobs on institutional HPC via Slurm (sbatch/squeue/scancel). Use when compute execution tier is ssh, or the user has a cluster login node configured under Settings → Compute → SSH hosts. Pair with the `remote` tool.
category: cloud-compute
license: MIT
metadata:
  skill-author: HYscience
version: 1.0.0
author: HYscience
tags: [Slurm, HPC, SSH, Batch]
---

# Slurm HPC

Run batch jobs on a cluster login node over SSH. Auth uses the local `ssh-agent` — no keys are stored in HYscience.

## Prerequisites

1. Settings → Compute → Execution tier = **SSH / Slurm** (or keep Local and still use `remote` explicitly)
2. At least one SSH host (login node) under Settings → Compute → SSH hosts
3. Local `ssh` can reach the host (`ssh user@host` works in your terminal)

## Workflow

### 1. List hosts

Ask the user which host if multiple exist, or use the first via `remote` without `host_id`.

### 2. Write a job script (on the remote host)

```bash
remote(command="cat > ~/jobs/run.sh <<'EOF'
#!/bin/bash
#SBATCH --job-name=hyscience
#SBATCH --output=logs/%x-%j.out
#SBATCH --error=logs/%x-%j.err
#SBATCH --time=04:00:00
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --gres=gpu:1   # remove if CPU-only
set -euo pipefail
cd \"$SLURM_SUBMIT_DIR\"
# module load ...
# python pipeline.py --input ... --output-dir ...
EOF
chmod +x ~/jobs/run.sh")
```

### 3. Submit

```bash
remote(command="mkdir -p ~/jobs/logs && sbatch ~/jobs/run.sh")
```

Capture the job id from `Submitted batch job <id>`.

### 4. Monitor

```bash
remote(command="squeue -u $USER")
remote(command="sacct -j <JOBID> --format=JobID,State,Elapsed,MaxRSS -P")
```

### 5. Cancel

```bash
remote(command="scancel <JOBID>")
```

## Rules

- Always estimate walltime / GPU / cost-equivalent before submit; wait for user approval on long GPU jobs
- Prefer writing outputs under the project Result directory when the cluster shares that filesystem; otherwise `scp` results back and call `provenance_record`
- Do not store SSH private keys in the repo or chat
- If `sbatch` is missing, the host is not a Slurm login node — fall back to interactive `remote` or switch execution tier to Cloud
