# Fixed vote script inside each voter box. The vote token exists only in this VM's
# env; the orchestrator never sees it. Evidence hash = sha256 over every script the
# agent ran plus its recorded output.
import glob, hashlib, json, os, sys, urllib.request
vote = json.loads(sys.argv[1])
h = hashlib.sha256()
for f in sorted(glob.glob("/var/handshake/evidence/run_*")):
    h.update(open(f, "rb").read())
body = {
    "token": os.environ["VOTE_TOKEN"],
    "voter": os.environ["VOTER"],
    "decision": vote["decision"],
    "ticket_id": vote["ticket_id"],
    "charge_id": vote.get("charge_id", ""),
    "amount_cents": vote.get("amount_cents", 0),
    "reason_code": vote.get("reason_code", ""),
    "evidence_hash": h.hexdigest(),
}
url_file = "/opt/handshake/vault_url"  # the vault's private IP, written by the orchestrator (no DNS between boxes)
vault_url = open(url_file).read().strip() if os.path.exists(url_file) else ""
if not vault_url:
    print(json.dumps({"ok": False, "reason": "no vault URL: the orchestrator has not wired this box yet"}))
    sys.exit(1)
req =urllib.request.Request(vault_url + "/vote",
                             data=json.dumps(body).encode(), headers={"content-type": "application/json"})
try:
    print(urllib.request.urlopen(req, timeout=30).read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode())
    sys.exit(1)
except urllib.error.URLError as e:
    print(json.dumps({"ok": False, "reason": f"vault unreachable: {e.reason}"}))
    sys.exit(1)
