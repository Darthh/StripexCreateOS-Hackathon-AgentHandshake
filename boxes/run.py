# Fixed runner inside each AI box (runs as root). The orchestrator uploads the agent's
# code to /var/handshake/evidence/run_N.py; this runs it and records stdout/stderr/exit
# next to it, so the evidence hash covers exactly what the agent ran and what it saw.
#
# Isolation: the agent's code runs as the unprivileged "agent" user with a scrubbed env,
# so it can't read VOTE_TOKEN (not from os.environ, not from /proc of root processes).
# /opt/handshake, /var/handshake/input and /var/handshake/evidence are root-owned and read-only
# for the agent, so it can't plant symlinks for root to write through. /work is its scratch.
import json, subprocess, sys
n = int(sys.argv[1])
env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/home/agent", "LANG": "C.UTF-8"}
try:
    # devbox's default Python lives under /root/.asdf and cannot run as agent.
    p = subprocess.run(["/usr/bin/python3", f"/var/handshake/evidence/run_{n}.py"], capture_output=True, text=True,
                       timeout=60, cwd="/work", env=env, user="agent", group="agent", extra_groups=())
    out = {"stdout": p.stdout[-20000:], "stderr": p.stderr[-20000:], "exit_code": p.returncode}
except subprocess.TimeoutExpired:
    out = {"stdout": "", "stderr": "timed out after 60 s", "exit_code": 124}
except OSError as e:
    out = {"stdout": "", "stderr": f"could not launch agent Python: {e}", "exit_code": 126}
subprocess.run(["pkill", "-KILL", "-u", "agent"])  # nothing the agent started outlives its run
with open(f"/var/handshake/evidence/run_{n}.out", "w") as f:
    f.write(json.dumps(out))
print(json.dumps(out))
