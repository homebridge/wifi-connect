const assert = require("node:assert/strict");
const { afterEach, beforeEach, describe, it, mock } = require("node:test");

const FakeBin = require("./helpers/fake-bin");
const network = require("../network");
const logger = require("../server/logger");
const createServer = require("../server");
const supervisor = require("../server/supervisor");

const WIFI_A = "11111111-2222-3333-4444-555555555555";

function quiet() {
    const log = logger();

    log.lines = [];
    log.print = (...args) => log.lines.push(args.join(" "));
    log.errors = (...args) => log.lines.push(args.join(" "));

    return log;
}

// A stand-in for the network module and the web server, so the decisions can be tested alone.
function world(state) {
    const events = [];

    const fakeNetwork = {
        get connected() { return state.connected; },
        devices: () => state.devices,
        wireless: { saved: () => state.saved },
    };

    const fakeServer = {
        start: (port, iface) => events.push(`start ${port} ${iface}`),
        stop: () => {
            events.push("stop");

            return Promise.resolve();
        },
    };

    const running = supervisor({
        network: fakeNetwork,
        server: fakeServer,
        log: quiet(),
        port: "80",
        exit: (code) => events.push(`exit ${code}`),
    });

    return { events, running, server: fakeServer };
}

// Moves the fake clock forward one second at a time, so timers that start other timers all run.
function seconds(count) {
    for (let i = 0; i < count; i += 1) mock.timers.tick(1000);
}

const WIFI_DEVICE = [{ iface: "eth0", type: "ethernet", active: false }, { iface: "wlan0", type: "wifi", active: false }];

describe("when the setup hotspot runs", () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ["setTimeout"] });
    });

    afterEach(() => {
        mock.timers.reset();
    });

    it("ends at once when a network is connected", () => {
        const { events, running } = world({ connected: true, devices: WIFI_DEVICE, saved: [] });

        running.start();

        assert.deepEqual(events, ["exit 0"]);
    });

    it("ends as soon as a network connects during the wait", () => {
        const state = { connected: false, devices: WIFI_DEVICE, saved: [] };
        const { events, running } = world(state);

        running.start();
        seconds(5);

        assert.deepEqual(events, []);

        state.connected = true;
        seconds(1);

        assert.deepEqual(events, ["exit 0"]);
    });

    it("does not start the hotspot when a WiFi network is saved, even with no connection", () => {
        const { events, running } = world({ connected: false, devices: WIFI_DEVICE, saved: [{ name: "Home", uuid: WIFI_A }] });

        running.start();
        seconds(19);

        assert.deepEqual(events, []);

        seconds(1);

        assert.deepEqual(events, ["exit 0"]);
    });

    it("does not start the hotspot on a device with no WiFi", () => {
        const { events, running } = world({ connected: false, devices: [{ iface: "eth0", type: "ethernet", active: false }], saved: [] });

        running.start();
        seconds(20);

        assert.deepEqual(events, ["exit 0"]);
    });

    it("starts the hotspot after the wait when no WiFi network is saved", () => {
        const { events, running } = world({ connected: false, devices: WIFI_DEVICE, saved: [] });

        running.start();
        seconds(20);

        assert.deepEqual(events, ["start 80 wlan0"]);
    });

    it("stops an unused hotspot after 5 minutes, checks again, and starts it again if nothing changed", async () => {
        const { events, running } = world({ connected: false, devices: WIFI_DEVICE, saved: [] });

        running.start();
        seconds(20);
        seconds(5 * 60 - 1);

        assert.deepEqual(events, ["start 80 wlan0"]);

        seconds(1);
        await Promise.resolve();

        assert.deepEqual(events, ["start 80 wlan0", "stop"]);

        seconds(20);

        assert.deepEqual(events, ["start 80 wlan0", "stop", "start 80 wlan0"]);
    });

    it("ends after the check when a network came up while the hotspot was on", async () => {
        const state = { connected: false, devices: WIFI_DEVICE, saved: [] };
        const { events, running } = world(state);

        running.start();
        seconds(20);

        state.connected = true;

        seconds(5 * 60);
        await Promise.resolve();

        assert.deepEqual(events, ["start 80 wlan0", "stop", "exit 0"]);
    });

    it("starts the 5 minutes again each time the setup page is used", async () => {
        const { events, running, server } = world({ connected: false, devices: WIFI_DEVICE, saved: [] });

        running.start();
        seconds(20);
        seconds(4 * 60);

        server.activity();

        seconds(4 * 60);
        await Promise.resolve();

        assert.deepEqual(events, ["start 80 wlan0"]);

        seconds(60);
        await Promise.resolve();

        assert.deepEqual(events, ["start 80 wlan0", "stop"]);
    });

    it("ends with code 0 once the device joined a WiFi network from the setup page", () => {
        const { events, running, server } = world({ connected: false, devices: WIFI_DEVICE, saved: [] });

        running.start();
        seconds(20);

        server.exit();
        seconds(10 * 60);

        assert.deepEqual(events, ["start 80 wlan0", "exit 0"]);
    });

    it("ends with code 1 when the web server can not start", () => {
        const { events, running, server } = world({ connected: false, devices: WIFI_DEVICE, saved: [] });

        running.start();
        seconds(20);

        server.failed(new Error("listen EADDRINUSE"));

        assert.deepEqual(events, ["start 80 wlan0", "exit 1"]);
    });

    it("stops the web server and all timers when told to stop", async () => {
        const { events, running } = world({ connected: false, devices: WIFI_DEVICE, saved: [] });

        running.start();
        seconds(20);

        await running.stop();
        seconds(10 * 60);

        assert.deepEqual(events, ["start 80 wlan0", "stop"]);
    });
});

describe("the web server and the hotspot together", () => {
    const BASE = [
        { program: "nmcli", has: ["device,type,state", "device"], stdout: "wlan0:wifi:disconnected\n" },
        { program: "nmcli", has: ["radio", "wifi"], stdout: "enabled\n" },
        { program: "hostapd", stay: true },
        { program: "dnsmasq", stay: true },
    ];

    let bin;
    let portal;

    function changes() {
        return bin.calls("nmcli")
            .filter((call) => !call.args.includes("--terse") && call.args.join(" ") !== "radio wifi")
            .map((call) => call.args.join(" "));
    }

    async function started() {
        portal.start("0", "wlan0");

        for (let i = 0; i < 100 && !portal.running; i += 1) await new Promise((resolve) => { setTimeout(resolve, 20); });

        return `http://127.0.0.1:${portal.server.address().port}`;
    }

    beforeEach(() => {
        bin = new FakeBin();
        bin.rules(BASE);
        portal = createServer(quiet());
        portal.exit = () => {};
    });

    afterEach(async () => {
        await portal.stop();
        network.hotspot.stop();
        bin.remove();
    });

    it("starts the hotspot with the web server, and stops both", async () => {
        await started();

        assert.equal(network.hotspot.running, true);
        assert.deepEqual(changes(), ["radio wifi on", "device disconnect wlan0"]);

        await portal.stop();

        assert.equal(network.hotspot.running, false);
        assert.equal(portal.server.listening, false);
    });

    it("can start again after a stop", async () => {
        await started();
        await portal.stop();

        const base = await started();

        assert.equal((await fetch(`${base}/api/`)).status, 200);
        assert.equal(network.hotspot.running, true);
    });

    it("tells the caller about every request", async () => {
        let count = 0;

        portal.activity = () => { count += 1; };

        const base = await started();

        await fetch(`${base}/api/`);
        await fetch(`${base}/api/networks/`);

        assert.equal(count, 2);
    });

    it("forgets the network and starts the hotspot again when a connection does not come up", async () => {
        bin.rules([
            { program: "nmcli", has: ["device", "wifi", "connect"], status: 4 },
            { program: "nmcli", has: ["--get-values", WIFI_A], stdout: "Home\n" },
            { program: "nmcli", has: ["name,uuid,type", "connection", "show"], stdout: `Home:${WIFI_A}:802-11-wireless\n` },
            ...BASE,
        ]);

        const base = await started();

        bin.clear();

        const response = await fetch(`${base}/api/wlan0/connect/`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ssid: "Home", password: "wrong password" }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(changes(), [
            "--wait 30 device wifi connect Home password wrong password ifname wlan0",
            `connection delete uuid ${WIFI_A}`,
            "device disconnect wlan0",
        ]);
        assert.equal(network.hotspot.running, true);
    });
});
