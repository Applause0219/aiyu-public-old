// fork 修改：claude 呼叫須帶 `--setting-sources ""`，不載入使用者的 CLAUDE.md／hooks／記憶。
// 實測（claude 2.1.328）：同一句 "Hello world"，未帶時輸入 8,345 tokens、帶上後 634 tokens。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), "aiyu-host.js");

// 假的 claude：把收到的每個 argv 寫成一行，再回一份 --output-format json 形狀的結果。
function fakeClaude(dir) {
  const bin = path.join(dir, "claude");
  fs.writeFileSync(bin, `#!/bin/sh
printf '%s\\n' "$@" > "${dir}/argv"
echo '{"result":"[{\\"id\\":\\"1\\",\\"zh\\":\\"你好\\"}]","modelUsage":{"claude-fake-1":{}}}'
`, { mode: 0o755 });
  return bin;
}

function translateOnce(bin, dir) {
  return new Promise((resolve, reject) => {
    const host = spawn(process.execPath, [HOST], {
      env: { ...process.env, AIYU_CLAUDE_PATH: bin, AIYU_LOG: path.join(dir, "host.log") },
      stdio: ["pipe", "pipe", "inherit"]
    });
    let buf = Buffer.alloc(0);
    host.stdout.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
        const reply = JSON.parse(buf.subarray(4, 4 + buf.readUInt32LE(0)).toString("utf8"));
        host.stdin.end();
        resolve(reply);
      }
    });
    host.on("error", reject);
    const json = Buffer.from(JSON.stringify({
      id: 1, action: "translate", cli: "claude", context: "youtube", target: "zh-TW",
      segments: [{ id: "1", text: "hello" }]
    }));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(json.length);
    host.stdin.write(Buffer.concat([len, json]));
  });
}

test("claude is spawned with --setting-sources \"\" and the translation still comes back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiyu-claude-"));
  const reply = await translateOnce(fakeClaude(dir), dir);
  const argv = fs.readFileSync(path.join(dir, "argv"), "utf8").split("\n");
  const i = argv.indexOf("--setting-sources");
  assert.notEqual(i, -1, `argv 缺少 --setting-sources：${JSON.stringify(argv)}`);
  assert.equal(argv[i + 1], "", "--setting-sources 的值必須是空字串");
  assert.ok(argv.includes("--tools"), "原本的 --tools 隔離不能被拿掉");
  assert.deepEqual(reply.result, [{ id: "1", zh: "你好" }]);
  assert.equal(reply.meta?.model, "claude-fake-1");
});
