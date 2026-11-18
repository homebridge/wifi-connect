// Test helper: a folder of fake programs (nmcli, ip, hostapd, dnsmasq).
//
// Each fake program writes its name and its argument list to a log file, then prints the answer
// the test asked for. Nothing real is run, so the tests need no network and no root rights.

const { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const command = require("../../network/command");

const PROGRAMS = ["nmcli", "ip", "hostapd", "dnsmasq"];

// The body of every fake program. It runs with the same Node.js that runs the tests.
const SCRIPT = `
const { appendFileSync, existsSync, readFileSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");

const folder = dirname(process.argv[1]);
const program = basename(process.argv[1]);
const args = process.argv.slice(2);

appendFileSync(join(folder, "calls.log"), JSON.stringify({ program, args }) + "\\n");

const rules = existsSync(join(folder, "rules.json")) ? JSON.parse(readFileSync(join(folder, "rules.json"), "utf8")) : [];

// A rule matches when the program name is the same and its "has" values appear in the arguments, in order.
const rule = rules.find((item) => {
    if (item.program !== program) return false;

    let from = 0;

    return (item.has || []).every((value) => {
        const index = args.indexOf(value, from);

        if (index === -1) return false;

        from = index + 1;

        return true;
    });
}) || {};

if (rule.stdout) process.stdout.write(rule.stdout);

if (rule.stay) {
    // long running programs (hostapd, dnsmasq) stay alive until they are stopped
    setInterval(() => {}, 1000);
} else {
    process.exit(rule.status || 0);
}
`;

class FakeBin {
    constructor() {
        this.folder = mkdtempSync(join(tmpdir(), "wifi-connect-test-"));
        this.previous = command.searchPath;

        for (const program of PROGRAMS) {
            writeFileSync(join(this.folder, program), `#!${process.execPath}\n${SCRIPT}`);
            chmodSync(join(this.folder, program), 0o755);
        }

        this.rules([]);

        command.searchPath = [this.folder];
    }

    // Sets the answers. Example: [{ program: "nmcli", has: ["radio", "wifi"], stdout: "enabled\n" }]
    rules(rules) {
        writeFileSync(join(this.folder, "rules.json"), JSON.stringify(rules));
    }

    // Every call so far, as { program, args }.
    calls(program) {
        const file = join(this.folder, "calls.log");

        if (!existsSync(file)) return [];

        return readFileSync(file, "utf8").split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line))
            .filter((call) => !program || call.program === program);
    }

    clear() {
        rmSync(join(this.folder, "calls.log"), { force: true });
    }

    remove() {
        command.searchPath = this.previous;

        rmSync(this.folder, { recursive: true, force: true });
    }
}

module.exports = FakeBin;
