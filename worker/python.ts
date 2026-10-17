// devbox's default Python is under /root/.asdf. Generated code uses the
// system interpreter, so install there and verify access as agent first.
// Call after creating the agent user and before sealing PyPI egress.
export const AGENT_PYTHON_SETUP = [
  "set -e",
  "if ! /usr/bin/python3 -c 'import pandas' 2>/dev/null; then",
  "  if /usr/bin/python3 -m pip --version >/dev/null 2>&1; then",
  "    /usr/bin/python3 -m pip install -q --break-system-packages pandas",
  "  elif python3 -m pip --version >/dev/null 2>&1; then",
  "    python3 -m pip --python /usr/bin/python3 install -q --break-system-packages pandas",
  "  else",
  "    echo 'agent Python setup failed: no usable pip installer' >&2; exit 1",
  "  fi",
  "fi",
  "runuser -u agent -- env -i PATH=/usr/bin:/bin HOME=/home/agent LANG=C.UTF-8 /usr/bin/python3 -c 'import os, pandas; assert os.geteuid() != 0; assert 0 not in os.getgroups()'",
].join("\n");
