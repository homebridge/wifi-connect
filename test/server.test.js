const assert = require("node:assert/strict");
const { after, afterEach, before, beforeEach, describe, it } = require("node:test");

const FakeBin = require("./helpers/fake-bin");
const network = require("../network");
const logger = require("../server/logger");
const createServer = require("../server");

const DEVICES = "eth0:ethernet:unavailable\nwlan0:wifi:disconnected\nlo:loopback:unmanaged\n";
const WIFI_A = "11111111-2222-3333-4444-555555555555";

// what the fake nmcli answers unless a test says otherwise
const BASE = [
    { program: "nmcli", has: ["device,type,state", "device"], stdout: DEVICES },
    { program: "nmcli", has: ["radio", "wifi"], stdout: "enabled\n" },
    { program: "hostapd", stay: true },
    { program: "dnsmasq", stay: true },
];

let bin;
let portal;
let base;
let exits;

function changes() {
    // every call that changes something, as "program arg arg ..."
    return bin.calls()
        .filter((call) => !call.args.includes("--terse") && call.args.join(" ") !== "radio wifi")
        .map((call) => `${call.program} ${call.args.join(" ")}`);
}

async function request(method, path, body) {
    const response = await fetch(`${base}${path}`, {
        method,
        redirect: "manual",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();

    return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

before(async () => {
    const log = logger();

    log.output = () => {};
    log.print = () => {};

    portal = createServer(log);
    portal.exit = () => { exits += 1; };

    await new Promise((resolve) => { portal.server.listen(0, "127.0.0.1", resolve); });

    base = `http://127.0.0.1:${portal.server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => { portal.server.close(resolve); });
});

beforeEach(() => {
    bin = new FakeBin();
    bin.rules(BASE);
    exits = 0;
});

afterEach(() => {
    network.hotspot.stop();
    bin.remove();
});

describe("status", () => {
    it("reports the devices, connections and hotspot state", async () => {
        const response = await request("GET", "/api/");

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, {
            connected: false,
            connections: [],
            wireless: true,
            hotspot: { running: false },
            devices: [{ iface: "eth0", type: "ethernet", active: false }, { iface: "wlan0", type: "wifi", active: false }],
        });
    });

    it("lists the networks in range", async () => {
        bin.rules([...BASE, { program: "nmcli", has: ["device", "wifi", "list"], stdout: "no:Home:AA\\:AA\\:AA\\:AA\\:AA\\:01:Infra:1:2412 MHz:60:WPA2::pair_ccmp psk\n" }]);

        const response = await request("GET", "/api/networks/");

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.map((item) => item.ssid), ["Home"]);
    });
});

describe("connect", () => {
    it("joins the network and ends the program when the connection is up", async () => {
        bin.rules([
            { program: "nmcli", has: ["active,ssid,bssid,mode,chan,freq,signal,security,wpa-flags,rsn-flags,device", "device", "wifi"], stdout: "yes:Home:AA\\:AA\\:AA\\:AA\\:AA\\:01:Infra:1:2412 MHz:60:WPA2::pair_ccmp psk:wlan0\n" },
            ...BASE,
        ]);

        const response = await request("POST", "/api/wlan0/connect/", { ssid: "Home", password: "secret password" });

        assert.equal(response.status, 200);
        assert.equal(exits, 1);
        assert.deepEqual(changes(), [
            "ip addr flush dev wlan0",
            "nmcli --wait 30 device wifi connect Home password secret password ifname wlan0",
        ]);
    });

    it("answers 400 and runs nothing for a value that fails its check", async () => {
        const bad = [
            ["/api/wlan0/connect/", { ssid: "line\nbreak", password: "password" }],
            ["/api/wlan0/connect/", { ssid: "", password: "password" }],
            ["/api/wlan0/connect/", { ssid: "a".repeat(33), password: "password" }],
            ["/api/wlan0/connect/", { ssid: ["Home"], password: "password" }],
            ["/api/wlan0/connect/", { ssid: "Home", password: "a".repeat(65) }],
            ["/api/wlan0/connect/", { ssid: "Home", password: { value: "x" } }],
            ["/api/wlan0/connect/", undefined],
            ["/api/wlan0%3Breboot/connect/", { ssid: "Home", password: "password" }],
            ["/api/-wlan0/connect/", { ssid: "Home", password: "password" }],
            ["/api/eth0/connect/", { ssid: "Home", password: "password" }],
            ["/api/wlan9/connect/", { ssid: "Home", password: "password" }],
        ];

        for (const [path, body] of bad) {
            bin.clear();

            const response = await request("POST", path, body);

            assert.equal(response.status, 400, `${path} ${JSON.stringify(body)}`);
            assert.deepEqual(response.body, { error: "invalid request" });
            assert.deepEqual(changes(), []);
        }

        assert.equal(exits, 0);
    });
});

describe("disconnect", () => {
    it("disconnects and forgets the saved WiFi network with that name", async () => {
        bin.rules([
            { program: "nmcli", has: ["--get-values", WIFI_A], stdout: "Home\n" },
            { program: "nmcli", has: ["name,uuid,type", "connection", "show"], stdout: `Home:${WIFI_A}:802-11-wireless\n` },
            ...BASE,
        ]);

        const response = await request("POST", "/api/wlan0/disconnect/", { ssid: "Home" });

        assert.equal(response.status, 200);
        assert.deepEqual(changes(), [
            "ip addr flush dev wlan0",
            "nmcli device disconnect wlan0",
            `nmcli connection delete uuid ${WIFI_A}`,
        ]);
    });

    it("answers 400 and runs nothing for a value that fails its check", async () => {
        const bad = [
            ["/api/wlan0/disconnect/", { ssid: "line\nbreak" }],
            ["/api/wlan0/disconnect/", { ssid: { name: "Home" } }],
            ["/api/wlan0/disconnect/", {}],
            ["/api/wlan0/disconnect/", undefined],
            ["/api/wlan0%20--all/disconnect/", { ssid: "Home" }],
            ["/api/eth0/disconnect/", { ssid: "Home" }],
        ];

        for (const [path, body] of bad) {
            bin.clear();

            const response = await request("POST", path, body);

            assert.equal(response.status, 400, `${path} ${JSON.stringify(body)}`);
            assert.deepEqual(changes(), []);
        }
    });

    it("only removes a saved network whose name is the same, whatever the name holds", async () => {
        bin.rules([
            { program: "nmcli", has: ["--get-values", WIFI_A], stdout: "Home\n" },
            { program: "nmcli", has: ["name,uuid,type", "connection", "show"], stdout: `Home:${WIFI_A}:802-11-wireless\n` },
            ...BASE,
        ]);

        const response = await request("POST", "/api/wlan0/disconnect/", { ssid: "Home; and more" });

        assert.equal(response.status, 200);
        assert.deepEqual(changes(), ["ip addr flush dev wlan0", "nmcli device disconnect wlan0"]);
    });
});

describe("hotspot", () => {
    it("starts and stops the access point", async () => {
        assert.equal((await request("POST", "/api/hotspot/start/", {})).status, 200);
        assert.equal(network.hotspot.running, true);
        assert.equal((await request("GET", "/api/")).body.hotspot.iface, "wlan0");
        assert.equal((await request("POST", "/api/hotspot/stop/")).status, 200);
        assert.equal(network.hotspot.running, false);
    });

    it("answers 400 and starts nothing for a value that fails its check", async () => {
        const bad = [{ ssid: "Setup\nwpa=0" }, { iface: "wlan0\ninterface=eth0" }, { iface: "eth0" }, { ssid: { a: 1 } }];

        for (const body of bad) {
            bin.clear();

            assert.equal((await request("POST", "/api/hotspot/start/", body)).status, 400, JSON.stringify(body));
            assert.deepEqual(changes(), []);
            assert.equal(network.hotspot.running, false);
        }
    });
});

describe("ethernet", () => {
    it("brings a cable device up and down", async () => {
        assert.equal((await request("POST", "/api/eth0/up/")).status, 200);
        assert.equal((await request("POST", "/api/eth0/down/")).status, 200);
        assert.deepEqual(changes(), ["nmcli device connect eth0", "nmcli device disconnect eth0"]);
    });

    it("answers 400 and runs nothing for a device that is not a cable device", async () => {
        for (const path of ["/api/wlan0/up/", "/api/eth9/down/", "/api/eth0%20x/up/", "/api/-h/down/"]) {
            bin.clear();

            assert.equal((await request("POST", path)).status, 400, path);
            assert.deepEqual(changes(), []);
        }
    });
});
