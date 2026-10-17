# Fixed runner inside each AI box. The agent's code is in /work/evidence/run_N.py;
# this runs it and records stdout/stderr/exit next to it, so the evidence hash
# covers exactly what the agent ran and what it saw.
import json, subprocess, sys
n = sys.argv[1]
p = subprocess.run([sys.executable, f"/work/evidence/run_{n}.py"], capture_output=True, text=True, timeout=60, cwd="/work")
out = {"stdout": p.stdout[-20000:], "stderr": p.stderr[-20000:], "exit_code": p.returncode}
open(f"/work/evidence/run_{n}.out", "w").write(json.dumps(out))
print(json.dumps(out))
