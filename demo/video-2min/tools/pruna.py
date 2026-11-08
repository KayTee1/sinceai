"""Pruna helper: stills (p-image) and clips (p-video-2). Key only from env, never printed."""
import json, os, sys, time, urllib.request, urllib.error
KEY = os.environ["PRUNA_API_KEY"]
BASE = "https://api.pruna.ai/v1"

def _req(url, body=None, headers=None, method="GET", timeout=120):
    h = {"apikey": KEY, **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    if data: h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read()[:500].decode(errors='replace')}")

def predict(model, inp, sync=True, poll_s=600):
    hdr = {"Model": model}
    if sync: hdr["Try-Sync"] = "true"
    r = json.loads(_req(f"{BASE}/predictions", {"input": inp}, hdr, "POST", timeout=150))
    return wait(r, poll_s)

def wait(r, poll_s=900):
    get_url = r.get("get_url")
    t0 = time.time()
    while r.get("status") not in ("succeeded", "failed"):
        if time.time() - t0 > poll_s: raise RuntimeError("timeout waiting for prediction")
        time.sleep(4)
        r = json.loads(_req(get_url))
    if r["status"] == "failed":
        raise RuntimeError(f"failed: {r.get('error')} moderation={r.get('moderation')}")
    return r

def download(url, path):
    open(path, "wb").write(_req(url, timeout=300))

def upload(path):
    import uuid
    boundary = uuid.uuid4().hex
    data = open(path, "rb").read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"content\"; filename=\"{os.path.basename(path)}\"\r\n"
            f"Content-Type: image/jpeg\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    r = urllib.request.Request(f"{BASE}/files", data=body, method="POST",
        headers={"apikey": KEY, "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.load(resp)["urls"]["get"]
