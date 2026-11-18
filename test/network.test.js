const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const FakeBin = require("./helpers/fake-bin");
const network = require("../network");
const command = require("../network/command");
const Hotspot = require("../network/hotspot");
const terse = require("../network/terse");
const validate = require("../network/validate");

const WIFI_A = "11111111-2222-3333-4444-555555555555";
const WIFI_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CABLE = "99999999-8888-7777-6666-555555555555";

let bin;

beforeEach(() => {
    bin = new FakeBin();
});

afterEach(() => {
    network.hotspot.stop();
    bin.remove();
});

describe("terse output", () => {
    it("splits a line into fields", () => {
        assert.deepEqual(terse.fields("yes:Home:wlan0"), ["yes", "Home", "wlan0"]);
    });

    it("keeps an escaped colon and an escaped backslash inside a value", () => {
        assert.deepEqual(terse.fields("no:My\\:Net\\\\work:AA\\:BB\\:CC\\:DD\\:EE\\:FF"), ["no", "My:Net\\work", "AA:BB:CC:DD:EE:FF"]);
    });

    it("drops records that are too short", () => {
        assert.deepEqual(terse.records("a:b:c\n\nbroken\n", 3), [["a", "b", "c"]]);
    });
});

describe("name checks", () => {
    it("accepts normal interface names", () => {
        for (const name of ["wlan0", "eth0", "enx001122334455", "wlp2s0", "end0", "eth0.100"]) {
            assert.equal(validate.iface(name), true, name);
        }
    });

    it("rejects interface names with other characters, a leading dash, or more than 15 characters", () => {
        for (const name of ["", "-wlan0", "wlan0 ", "wlan 0", "wlan0;", "wlan0\n", "a".repeat(16), "wlan0:0", "wlan'0", undefined, null, 5, ["wlan0"]]) {
            assert.equal(validate.iface(name), false, String(name));
        }
    });

    it("accepts WiFi names of 1 to 32 bytes, with spaces and symbols", () => {
        for (const name of ["Home", "My Home WiFi", "Café ☕", "it's; \"quoted\" $(name) `x`", "-dash", "a".repeat(32)]) {
            assert.equal(validate.ssid(name), true, name);
        }
    });

    it("rejects WiFi names that are empty, too long, not text, or hold control characters", () => {
        for (const name of ["", "a".repeat(33), "é".repeat(17), "line\nbreak", "tab\there", "nul\u0000", undefined, null, 7, { ssid: "x" }]) {
            assert.equal(validate.ssid(name), false, String(name));
        }
    });

    it("accepts no password, and rejects passwords that are too long or hold control characters", () => {
        assert.equal(validate.password(undefined), true);
        assert.equal(validate.password(""), true);
        assert.equal(validate.password("correct horse battery staple"), true);
        assert.equal(validate.password("a".repeat(65)), false);
        assert.equal(validate.password("two\nlines"), false);
        assert.equal(validate.password(12345678), false);
    });
});

describe("running programs", () => {
    it("hands every value to the program as one argument, unchanged", () => {
        const folder = mkdtempSync(join(tmpdir(), "wifi-connect-cwd-"));
        const previous = process.cwd();
        const names = ["x; touch MARKER", "$(touch MARKER)", "`touch MARKER`", "a && touch MARKER", "'; touch MARKER; '", "two  spaces", "-dash", "| touch MARKER"];

        process.chdir(folder);

        try {
            for (const name of names) {
                bin.clear();

                assert.equal(network.wireless.connect(name, "pass word; touch MARKER", "wlan0"), true);

                const call = bin.calls("nmcli")[0];

                assert.deepEqual(call.args, ["--wait", "30", "device", "wifi", "connect", name, "password", "pass word; touch MARKER", "ifname", "wlan0"]);
                assert.equal(existsSync(join(folder, "MARKER")), false);
            }
        } finally {
            process.chdir(previous);
            rmSync(folder, { recursive: true, force: true });
        }
    });

    it("only looks for programs in its own search folders", () => {
        assert.equal(command.path("nmcli"), join(bin.folder, "nmcli"));
        assert.equal(command.path("sh"), undefined);
        assert.equal(command.path("../nmcli"), undefined);
    });

    it("gives the programs a small fixed environment", () => {
        assert.deepEqual(Object.keys(command.environment).sort(), ["LANG", "LC_ALL", "PATH"]);
    });

    it("returns undefined and reports the program, not its arguments, when a program fails", () => {
        const failures = [];

        bin.rules([{ program: "nmcli", has: ["radio"], status: 4 }]);
        command.onError = (...details) => failures.push(details);

        try {
            assert.equal(command.exec("nmcli", ["radio", "wifi"]), undefined);
            assert.deepEqual(failures, [["nmcli", 4]]);
        } finally {
            command.onError = null;
        }
    });

    it("refuses arguments that are not a list of text values", () => {
        assert.throws(() => command.exec("nmcli", "radio wifi"), TypeError);
        assert.throws(() => command.exec("nmcli", ["radio", 5]), TypeError);
    });
});

describe("wireless", () => {
    it("reads and sets the WiFi radio state", () => {
        bin.rules([{ program: "nmcli", has: ["radio", "wifi", "on"] }, { program: "nmcli", has: ["radio", "wifi"], stdout: "enabled\n" }]);

        assert.equal(network.wireless.enabled, true);

        network.wireless.enabled = false;

        assert.deepEqual(bin.calls("nmcli").map((call) => call.args), [["radio", "wifi"], ["radio", "wifi", "off"]]);
    });

    it("lists the networks in range, grouped by name", () => {
        bin.rules([{
            program: "nmcli",
            has: ["device", "wifi", "list"],
            stdout: [
                "no:Home:AA\\:AA\\:AA\\:AA\\:AA\\:01:Infra:1:2412 MHz:60:WPA2:pair_ccmp psk:pair_ccmp psk",
                "no:Home:AA\\:AA\\:AA\\:AA\\:AA\\:02:Infra:36:5180 MHz:85:WPA2::pair_ccmp psk",
                "no:Cafe\\: free:BB\\:BB\\:BB\\:BB\\:BB\\:01:Infra:6:2437 MHz:40::::",
                "no::CC\\:CC\\:CC\\:CC\\:CC\\:01:Infra:11:2462 MHz:30:WPA2::",
                "",
            ].join("\n"),
        }]);

        const networks = network.wireless.scan("wlan0");

        assert.deepEqual(bin.calls("nmcli")[0].args.slice(-2), ["ifname", "wlan0"]);
        assert.deepEqual(networks.map((item) => [item.ssid, item.quality, item.security.mode, item.channels.length]), [
            ["Home", 85, "WPA2", 2],
            ["Cafe: free", 40, "none", 1],
        ]);
        assert.equal(networks[0].channels[1].bssid, "AA:AA:AA:AA:AA:02");
        assert.equal(networks[0].channels[1].frequency, 5180);
    });

    it("does not scan on an interface name that fails the check", () => {
        assert.deepEqual(network.wireless.scan("wlan0; reboot"), []);
        assert.deepEqual(bin.calls(), []);
    });

    it("lists the connected networks", () => {
        bin.rules([{
            program: "nmcli",
            has: ["device", "wifi"],
            stdout: "yes:Home:AA\\:AA\\:AA\\:AA\\:AA\\:02:Infra:36:5180 MHz:85:WPA2::pair_ccmp psk:wlan0\nno:Other:DD\\:DD\\:DD\\:DD\\:DD\\:01:Infra:1:2412 MHz:20:WPA2:::wlan0\n",
        }]);

        assert.deepEqual(network.wireless.current().map((item) => [item.iface, item.ssid, item.quality]), [["wlan0", "Home", 85]]);
    });

    it("lists only the saved WiFi networks", () => {
        bin.rules([{
            program: "nmcli",
            has: ["connection", "show"],
            stdout: `Home:${WIFI_A}:802-11-wireless\nWired connection 1:${CABLE}:802-3-ethernet\nlo:not-a-uuid:loopback\npreconfigured:${WIFI_B}:802-11-wireless\n`,
        }]);

        assert.deepEqual(network.wireless.saved(), [{ name: "Home", uuid: WIFI_A }, { name: "preconfigured", uuid: WIFI_B }]);
    });

    it("does not run anything when a connect value fails its check", () => {
        assert.equal(network.wireless.connect("line\nbreak", "password", "wlan0"), false);
        assert.equal(network.wireless.connect("Home", "password", "wlan0 extra"), false);
        assert.equal(network.wireless.connect("Home", "a".repeat(65), "wlan0"), false);
        assert.equal(network.wireless.connect(undefined, undefined, undefined), false);
        assert.deepEqual(bin.calls(), []);
    });

    it("leaves the password out for an open network", () => {
        assert.equal(network.wireless.connect("Cafe", "", "wlan0"), true);
        assert.deepEqual(bin.calls("nmcli")[0].args, ["--wait", "30", "device", "wifi", "connect", "Cafe", "ifname", "wlan0"]);
        assert.deepEqual(bin.calls("ip")[0].args, ["addr", "flush", "dev", "wlan0"]);
    });

    it("reports a failed connection", () => {
        bin.rules([{ program: "nmcli", has: ["device", "wifi", "connect"], status: 4 }]);

        assert.equal(network.wireless.connect("Home", "wrong password", "wlan0"), false);
    });

    it("disconnects and reapplies only on an interface name that passes the check", () => {
        assert.equal(network.wireless.disconnect("wlan0"), true);
        assert.equal(network.wireless.reapply("wlan0"), true);
        assert.equal(network.wireless.disconnect("wlan0 --all"), false);
        assert.equal(network.wireless.reapply(""), false);
        assert.deepEqual(bin.calls("nmcli").map((call) => call.args), [["device", "disconnect", "wlan0"], ["device", "reapply", "wlan0"]]);
    });

    it("forgets a saved WiFi network by its id, matched on the connection name or the network name", () => {
        bin.rules([
            { program: "nmcli", has: ["--get-values", WIFI_A], stdout: "Home\n" },
            { program: "nmcli", has: ["--get-values", WIFI_B], stdout: "Cafe\\: free\n" },
            { program: "nmcli", has: ["connection", "show"], stdout: `Home:${WIFI_A}:802-11-wireless\nCafe\\: free:${CABLE}:802-3-ethernet\npreconfigured:${WIFI_B}:802-11-wireless\n` },
        ]);

        assert.equal(network.wireless.forget("Cafe: free"), 1);

        const deleted = bin.calls("nmcli").filter((call) => call.args.includes("delete"));

        // the cable connection has the same name, and it must stay
        assert.deepEqual(deleted.map((call) => call.args), [["connection", "delete", "uuid", WIFI_B]]);
    });

    it("forgets nothing when the name is not saved or fails the check", () => {
        bin.rules([
            { program: "nmcli", has: ["--get-values"], stdout: "Home\n" },
            { program: "nmcli", has: ["connection", "show"], stdout: `Home:${WIFI_A}:802-11-wireless\n` },
        ]);

        assert.equal(network.wireless.forget("Other"), 0);
        assert.equal(network.wireless.forget("x\ny"), 0);
        assert.equal(network.wireless.forget(undefined), 0);
        assert.equal(bin.calls("nmcli").filter((call) => call.args.includes("delete")).length, 0);
    });
});

describe("ethernet and devices", () => {
    const DEVICES = "eth0:ethernet:connected\nwlan0:wifi:disconnected\nlo:loopback:unmanaged\np2p-dev-wlan0:wifi-p2p:disconnected\n";

    it("lists the devices NetworkManager looks after", () => {
        bin.rules([{ program: "nmcli", has: ["device,type,state", "device"], stdout: DEVICES }]);

        assert.deepEqual(network.devices(), [
            { iface: "eth0", type: "ethernet", active: true },
            { iface: "wlan0", type: "wifi", active: false },
            { iface: "p2p-dev-wlan0", type: "wifi-p2p", active: false },
        ]);
    });

    it("reports connected when a cable connection is up", () => {
        bin.rules([{ program: "nmcli", has: ["active,device,type", "connection", "show"], stdout: "yes:eth0:802-3-ethernet\nno::802-11-wireless\n" }]);

        assert.deepEqual(network.current(), [{ iface: "eth0" }]);
        assert.equal(network.connected, true);
    });

    it("reports not connected when nothing is up", () => {
        bin.rules([{ program: "nmcli", has: ["active,device,type", "connection", "show"], stdout: "no::802-3-ethernet\n" }]);

        assert.equal(network.connected, false);
    });

    it("brings a cable device up or down only when it is a known cable device", () => {
        bin.rules([{ program: "nmcli", has: ["device,type,state", "device"], stdout: DEVICES }]);

        assert.equal(network.ethernet.up("eth0"), true);
        assert.equal(network.ethernet.down("eth0"), true);
        assert.equal(network.ethernet.down("wlan0"), false);
        assert.equal(network.ethernet.up("eth9"), false);
        assert.equal(network.ethernet.up("eth0 extra"), false);

        const changes = bin.calls("nmcli").map((call) => call.args).filter((args) => args.includes("connect") || args.includes("disconnect"));

        assert.deepEqual(changes, [["device", "connect", "eth0"], ["device", "disconnect", "eth0"]]);
    });
});

describe("hotspot", () => {
    function wait(milliseconds) {
        return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
    }

    async function until(check) {
        for (let i = 0; i < 100 && !check(); i += 1) await wait(50);

        return check();
    }

    it("starts the access point with its own config files, and stops it again", async () => {
        bin.rules([{ program: "hostapd", stay: true }, { program: "dnsmasq", stay: true }]);

        const hotspot = new Hotspot({ uuid: { code: "TEST" } });

        assert.equal(hotspot.start("Homebridge WiFi Setup", "wlan0"), true);
        assert.deepEqual(hotspot.status, { running: true, iface: "wlan0", ssid: "Homebridge WiFi Setup (TEST)" });

        assert.equal(await until(() => bin.calls("hostapd").length === 1 && bin.calls("dnsmasq").length === 1), true);

        const folder = hotspot.folder;
        const hostapd = readFileSync(bin.calls("hostapd")[0].args[0], "utf8");
        const dnsmasq = readFileSync(join(folder, "dnsmasq.conf"), "utf8");

        assert.match(hostapd, /^interface=wlan0$/m);
        assert.match(hostapd, /^ssid=Homebridge WiFi Setup \(TEST\)$/m);
        assert.match(dnsmasq, /^interface=wlan0$/m);
        assert.match(dnsmasq, /^dhcp-range=192\.168\.4\.2,192\.168\.4\.10,255\.255\.255\.0,15m$/m);
        assert.match(dnsmasq, /^address=\/#\/192\.168\.4\.1$/m);
        assert.match(dnsmasq, /^local=\/#\/$/m);
        assert.deepEqual(bin.calls("dnsmasq")[0].args, ["--keep-in-foreground", `--conf-file=${join(folder, "dnsmasq.conf")}`, `--pid-file=${join(folder, "dnsmasq.pid")}`]);
        assert.deepEqual(bin.calls("ip").map((call) => call.args), [["addr", "flush", "dev", "wlan0"], ["addr", "add", "192.168.4.1/24", "dev", "wlan0"]]);

        const children = [hotspot.hostapd, hotspot.dnsmasq];

        hotspot.stop();

        assert.deepEqual(hotspot.status, { running: false });
        assert.equal(existsSync(folder), false);
        assert.equal(await until(() => children.every((child) => child.exitCode !== null || child.signalCode !== null)), true);
        assert.deepEqual(bin.calls("ip").at(-1).args, ["addr", "flush", "dev", "wlan0"]);
    });

    it("does not start with a name or an interface that fails the check", () => {
        const hotspot = new Hotspot({ uuid: { code: "TEST" } });

        assert.equal(hotspot.start("Setup\nwpa=0", "wlan0"), false);
        assert.equal(hotspot.start("a".repeat(30), "wlan0"), false);
        assert.equal(hotspot.start("Homebridge WiFi Setup", "wlan0\ninterface=eth0"), false);
        assert.equal(hotspot.running, false);
        assert.deepEqual(bin.calls(), []);
    });

    it("reports not running when hostapd stops by itself", async () => {
        bin.rules([{ program: "hostapd", status: 1 }, { program: "dnsmasq", stay: true }]);

        const hotspot = new Hotspot({ uuid: { code: "TEST" } });

        hotspot.start("Homebridge WiFi Setup", "wlan0");

        assert.equal(await until(() => !hotspot.running), true);

        hotspot.stop();
    });

    it("refuses addresses that are not IPv4 addresses", () => {
        assert.throws(() => new Hotspot({ gateway: "192.168.4.1\naddress=/#/1.2.3.4" }), TypeError);
    });
});
