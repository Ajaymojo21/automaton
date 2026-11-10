// Phase 16A review probe: does escapeShellArg()'s POSIX single-quote wrapping protect a
// model-supplied path when Node's execSync hands the command to cmd.exe on Windows?
// Read-only: the injected second command is `echo`, nothing is written.
const { execSync } = require("node:child_process");

// Verbatim copy of src/agent/tools.ts:3784 escapeShellArg
const escapeShellArg = (arg) => `'${arg.replace(/'/g, "'\\''")}'`;

const home = process.env.HOME;
console.log("HOME =", home);
console.log("COMSPEC =", process.env.ComSpec || process.env.COMSPEC || "(unset)");

const samples = [
  ["backslash path + &", home + "\\nope&echo INJECTED_AMP"],
  ["forward-slash path + &", home + "/nope&echo INJECTED_AMP"],
  ["pipe", home + "/nope|echo INJECTED_PIPE"],
];

for (const [label, confined] of samples) {
  const cmd = "cat " + escapeShellArg(confined);
  let out;
  try {
    out = execSync(cmd, { encoding: "utf8", timeout: 10000, cwd: home, stdio: ["ignore", "pipe", "pipe"] });
    out = { exitCode: 0, stdout: out, stderr: "" };
  } catch (e) {
    out = { exitCode: e.status, stdout: String(e.stdout || ""), stderr: String(e.stderr || "").slice(0, 160) };
  }
  console.log("\n--- " + label + " ---");
  console.log("command :", JSON.stringify(cmd));
  console.log("exitCode:", out.exitCode);
  console.log("stdout  :", JSON.stringify(out.stdout));
  console.log("stderr  :", JSON.stringify(out.stderr));
  console.log("INJECTED?", /INJECTED_/.test(out.stdout) ? "YES — second command executed" : "no");
}
