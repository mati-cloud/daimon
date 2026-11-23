// Finding (or starting) the pty-daemon.
//
// The daemon owns the shells and outlives the app, so tabs reopen with their shells —
// and any running command — intact. On launch the app looks for a running daemon
// (`pty-daemon --info`); if there is none it starts one with `--detach`, which returns
// once the daemon listens. DAIMON_PERSIST=0 instead ties the daemon to the app
// (`--exit-with-parent`): closing the app ends the sessions.
//
// All privileged commands from the page are proxied here through Electrobun's host IPC
// and sent to the daemon via its UNIX domain socket (mode 0600, uid-auth, no token).
// The page reads output via the TCP WebSocket (output-only push, no auth needed).
//
// Windows: the app bundles the Linux daemon and runs it inside WSL (distro from the
// bundled "wsl-distro" file); Windows reaches it through WSL's localhost forwarding.
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve, dirname, join } from "node:path";

export type Daemon = { port: number; socketPath: string };

type Info = {
  port: number;
  token: string;
  socket: string;
  selfBuild: string;
  running: { pid: number; port: number; token: string; build: string; socket: string } | null;
};

let tiedProc: ReturnType<typeof Bun.spawn> | null = null; // DAIMON_PERSIST=0: keeps stdin open

/** Check the TCP output port is reachable (plain TCP connect). */
function reachable(d: Daemon, timeoutMs = 600): Promise<boolean> {
  return new Promise((done) => {
    const sock = createConnection(d.port, "127.0.0.1");
    const timer = setTimeout(() => { sock.destroy(); done(false); }, timeoutMs);
    sock.on("connect", () => { clearTimeout(timer); sock.destroy(); done(true); });
    sock.on("error", () => { clearTimeout(timer); done(false); });
  });
}

async function waitReachable(d: Daemon, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(150)) {
    if (await reachable(d)) return true;
  }
  return false;
}

/** One request/response round trip over the UNIX socket.
 *  Resolves the daemon's reply envelope `{ok, data}` — where `data` may legitimately be
 *  null (e.g. image/prefGet/linkPreview miss). Resolves `null` ONLY on transport failure
 *  (no daemon, connect error, timeout) so callers can tell "no daemon" from "null result". */
export function requestEnvelope(d: Daemon, msg: object): Promise<{ ok: boolean; data: unknown } | null> {
  // Slow commands (exec, image, linkPreview, git, daemonInfo, pluginApprove) carry their
  // own budget; the host must outwait the daemon or it destroys the socket mid-reply
  // (broken pipe) and the page gets a false "daemon unreachable". `host_timeout_ms` is the
  // page's own deadline (rpc.ts); `timeout_ms` is exec's daemon budget. Default 3s.
  const m = msg as { host_timeout_ms?: number; timeout_ms?: number };
  const budget = m.host_timeout_ms ?? m.timeout_ms ?? 3000;
  const timeoutMs = budget + 2000;
  return new Promise((done) => {
    const sock = createConnection(d.socketPath);
    let buf = "";
    const timer = setTimeout(() => { sock.destroy(); done(null); }, timeoutMs);
    const msgWithId = JSON.stringify({ req_id: "app", ...msg });
    sock.on("connect", () => sock.write(msgWithId + "\n"));
    sock.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const ev = JSON.parse(line);
        if (ev.type === "response") {
          clearTimeout(timer);
          sock.destroy();
          done({ ok: ev.ok !== false, data: ev.data });
        }
      } catch { /* ignore parse errors */ }
    });
    sock.on("error", () => { clearTimeout(timer); done(null); });
  });
}

/** Round trip returning just the payload (internal callers). Null = transport failure. */
export async function request<T>(d: Daemon, msg: object): Promise<T | null> {
  const env = await requestEnvelope(d, msg);
  return env ? (env.data as T) : null;
}

/** How to run the bundled daemon binary on this platform. */
function daemonCommand(): string[] {
  const daemonPath = resolve(import.meta.dir, "../pty-daemon");
  if (process.platform !== "win32") return [daemonPath];
  const distroFile = resolve(import.meta.dir, "../wsl-distro");
  const distro = existsSync(distroFile) ? readFileSync(distroFile, "utf8").trim() : "";
  const wsl = ["wsl.exe", ...(distro ? ["-d", distro] : []), "--cd", "~", "--exec"];
  const linuxPath = Bun.spawnSync([...wsl, "wslpath", "-u", daemonPath]).stdout.toString().trim();
  if (!linuxPath) console.error("[daemon] couldn't resolve the daemon path inside WSL", distro || "(default distro)");
  return [...wsl, linuxPath];
}

async function run(cmd: string[], args: string[]): Promise<string> {
  const p = Bun.spawn([...cmd, ...args], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.trim();
}

/** Dev: dev.sh runs the daemon and exports its socket path and port. */
async function devDaemon(): Promise<Daemon | null> {
  const socketPath = process.env.DAIMON_SOCKET;
  if (!socketPath) {
    console.error("[daemon] DAIMON_SOCKET not set — start the app through dev.sh");
    return null;
  }
  const d: Daemon = { socketPath, port: Number(process.env.DAIMON_PORT) || 7878 };
  if (!(await waitReachable(d, 5000))) console.warn("[daemon] dev daemon not reachable on port", d.port);
  return d;
}

export async function connectDaemon(isDev: boolean): Promise<Daemon | null> {
  if (isDev) return devDaemon();

  const cmd = daemonCommand();
  let info: Info;
  try {
    info = JSON.parse(await run(cmd, ["--info"]));
  } catch (err) {
    console.error("[daemon] `pty-daemon --info` failed:", err);
    return null;
  }
  const d: Daemon = { port: info.port, socketPath: info.socket };

  // A daemon is already running (the usual case after the first launch).
  if (info.running && (await reachable(d))) {
    if (info.running.build === info.selfBuild) return d;
    // It's an older build. Replacing it would end its shells, so only do that when it
    // has none; otherwise keep using it — the new one takes over next time it's idle.
    const status = await request<{ sessions: number }>(d, { type: "daemonInfo" });
    if (status && status.sessions > 0) {
      console.warn(`[daemon] running daemon is an older build with ${status.sessions} session(s) — keeping it`);
      return d;
    }
    console.log("[daemon] replacing idle daemon from an older build");
    await request(d, { type: "shutdown" });
    await Bun.sleep(300);
  }

  if (process.env.DAIMON_PERSIST === "0") {
    tiedProc = Bun.spawn([...cmd, "--exit-with-parent"], {
      stdin: "pipe", // held open for our lifetime: the daemon exits when it closes
      stdout: "inherit",
      stderr: "inherit",
    });
    console.log("[daemon] started (ends with the app), pid:", tiedProc.pid);
  } else {
    console.log("[daemon]", await run(cmd, ["--detach"]));
  }
  if (!(await waitReachable(d, 8000))) console.warn("[daemon] not reachable after start");
  return d;
}

/**
 * Restart the pty-daemon from the staged update bundle without restarting the whole app.
 * The staged bundle lives at `${appBundle}.prepared-${hash}` (PreparedUpdateV2 convention).
 * Returns the new Daemon connection, or null if the staged binary isn't found or start fails.
 */
export async function restartDaemon(current: Daemon, stagedHash: string): Promise<Daemon | null> {
  // macOS app bundle: process.execPath = .../Daimon2.app/Contents/MacOS/Daimon2
  // so the .app dir is 3 levels up from execPath.
  const appBundle = process.platform === "darwin"
    ? resolve(dirname(process.execPath), "..", "..")
    : resolve(dirname(process.execPath), "..", "..", "app");
  const stagedBundle = `${appBundle}.prepared-${stagedHash}`;
  const stagedDaemon = process.platform !== "win32"
    ? join(stagedBundle, "Contents", "Resources", "app", "pty-daemon")  // macOS/Linux
    : join(stagedBundle, "app", "pty-daemon");  // Windows

  if (!existsSync(stagedDaemon)) {
    console.warn("[daemon] staged daemon not found at", stagedDaemon);
    return null;
  }

  const cmd = process.platform !== "win32"
    ? [stagedDaemon]
    : daemonCommand(); // Windows: WSL path resolution; keep existing helper

  // Check sessions — only restart if none active.
  const status = await request<{ sessions: number }>(current, { type: "daemonInfo" });
  if (status && status.sessions > 0) {
    console.warn(`[daemon] staged restart skipped: ${status.sessions} active session(s)`);
    return null;
  }

  // Probe new daemon info to get the port/socket it will use.
  // Port and socket path are stable across restarts (read from state dir).
  let newInfo: Info;
  try {
    newInfo = JSON.parse(await run(cmd, ["--info"]));
  } catch (err) {
    console.error("[daemon] staged --info failed:", err);
    return null;
  }

  await request(current, { type: "shutdown" });
  await Bun.sleep(300);
  console.log("[daemon]", await run(cmd, ["--detach"]));
  const nd: Daemon = { port: newInfo.port, socketPath: newInfo.socket };
  if (!(await waitReachable(nd, 8000))) {
    console.warn("[daemon] staged daemon not reachable after restart");
    return null;
  }
  console.log("[daemon] restarted from staged bundle", stagedHash);
  return nd;
}

