#!/bin/sh
# Self-check for daimonify.sh under bash and zsh: an interactive shell that evals the payload
# (as the UI does over SSH) must emit OSC 133 markers the daemon accepts
# (crates/shell-parser PROMPT_MARKER / COMMAND_START_MARKER) with valid JSON.
# Run: sh shell-integration/daimonify_test.sh
here=$(cd "$(dirname "$0")" && pwd)
status=0
for sh in bash zsh; do
  command -v $sh >/dev/null || continue
  python3 -I - "$sh" "$here/daimonify.sh" <<'PY' || status=1
import os, pty, sys, time, select, json, re, base64, tempfile
shell, payload = sys.argv[1], sys.argv[2]
# A folder to list for path completion: a subfolder, and a name JSON would choke on.
tmp = tempfile.mkdtemp()
os.mkdir(os.path.join(tmp, "gitlab.example"))
open(os.path.join(tmp, 'q"uote'), "w").close()
os.chdir(tmp)
pid, fd = pty.fork()
if pid == 0:
    os.environ["HOME"] = "/nonexistent"
    os.execvp(shell, [shell, "-f" if shell == "zsh" else "--norc", "-i"])
def drain(t):
    out, end = b"", time.time() + t
    while time.time() < end:
        if select.select([fd], [], [], 0.05)[0]:
            try: out += os.read(fd, 65536)
            except OSError: break
    return out.decode(errors="replace")
drain(0.5)
os.write(fd, b' eval "$(cat %s)"\n' % payload.encode())
first = drain(1)
os.write(fd, b'false\n')
second = drain(1)
mark = re.compile(r'\x1b\]133;A(\{.*?\})\x1b\\')
m1, m2 = mark.search(first), mark.search(second)
assert m1, f"{shell}: no prompt marker after eval: {first!r}"
assert m2 and "\x1b]133;C\x1b\\" in second, f"{shell}: no C/A markers around a command: {second!r}"
d = json.loads(m2.group(1))
assert d["exitCode"] == 1 and "pwd" in d and "@" in d.get("ssh", ""), d
entries = base64.b64decode(d["ls"]).decode().splitlines()
assert entries == ["gitlab.example/", 'q"uote'], f"{shell}: listing {entries!r}"
print(f"ok: {shell}")
PY
done
exit $status
