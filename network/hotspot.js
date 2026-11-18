/**************************************************************************************************
 * homebridge wifi-connect                                                                        *
 * Copyright (C) 2026 Homebridge                                                                  *
 *                                                                                                *
 * This program is free software: you can redistribute it and/or modify                           *
 * it under the terms of the GNU General Public License as published by                           *
 * the Free Software Foundation, either version 3 of the License, or                              *
 * (at your option) any later version.                                                            *
 *                                                                                                *
 * This program is distributed in the hope that it will be useful,                                *
 * but WITHOUT ANY WARRANTY; without even the implied warranty of                                 *
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the                                  *
 * GNU General Public License for more details.                                                   *
 *                                                                                                *
 * You should have received a copy of the GNU General Public License                              *
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.                          *
 **************************************************************************************************/

const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const command = require("./command");
const validate = require("./validate");

// Runs a WiFi access point for the setup page:
//   - hostapd makes the WiFi network,
//   - dnsmasq hands out addresses and answers every name lookup with this device's address,
//     which is how phones find the setup page. Lookups for an IPv6 address get an empty answer.
// Both run as child processes with their own config files in a private folder. System-wide
// config files are not changed, and other copies of these programs are left alone.

class Hotspot {
    constructor(options) {
        const seed = parseInt(((options || {}).uuid || {}).seed, 10) || 4;

        this.uuid = ((options || {}).uuid || {}).code || Hotspot.uuid(seed);
        this.gateway = (options || {}).gateway || "192.168.4.1";

        this.dhcp = {
            start: ((options || {}).dhcp || {}).start || "192.168.4.2",
            end: ((options || {}).dhcp || {}).end || "192.168.4.10",
        };

        if (![this.gateway, this.dhcp.start, this.dhcp.end].every((address) => validate.ipv4(address))) {
            throw new TypeError("the hotspot addresses must be IPv4 addresses");
        }

        this.log = (options || {}).log || (() => {});
        this.hostapd = null;
        this.dnsmasq = null;
        this.folder = null;
    }

    get running() {
        return Hotspot.alive(this.hostapd);
    }

    get status() {
        if (this.running) {
            return {
                running: true,
                iface: this.iface,
                ssid: this.ssid,
            };
        }

        return {
            running: false,
        };
    }

    // Returns true if the access point was started.
    start(ssid, iface) {
        const name = `${ssid || "AP"}${this.uuid && this.uuid !== "" ? ` (${this.uuid})` : ""}`;

        if (!validate.ssid(name) || !validate.iface(iface)) return false;

        this.stop();

        this.ssid = name;
        this.iface = iface;
        this.folder = mkdtempSync(join(tmpdir(), "wifi-connect-"));

        const files = {
            hostapd: join(this.folder, "hostapd.conf"),
            dnsmasq: join(this.folder, "dnsmasq.conf"),
            pid: join(this.folder, "dnsmasq.pid"),
        };

        writeFileSync(files.hostapd, [
            `interface=${this.iface}`,
            "driver=nl80211",
            `ssid=${this.ssid}`,
            "channel=7",
            "hw_mode=g",
            "",
        ].join("\n"), { mode: 0o600 });

        writeFileSync(files.dnsmasq, [
            `interface=${this.iface}`,
            `listen-address=${this.gateway}`,
            "bind-interfaces",
            "except-interface=lo",
            `dhcp-range=${this.dhcp.start},${this.dhcp.end},255.255.255.0,15m`,
            `address=/#/${this.gateway}`,
            "local=/#/",
            "no-resolv",
            "no-hosts",
            "leasefile-ro",
            "",
        ].join("\n"), { mode: 0o600 });

        command.exec("ip", ["addr", "flush", "dev", this.iface]);
        command.exec("ip", ["addr", "add", `${this.gateway}/24`, "dev", this.iface]);

        this.dnsmasq = this.watch("dnsmasq", command.spawn("dnsmasq", ["--keep-in-foreground", `--conf-file=${files.dnsmasq}`, `--pid-file=${files.pid}`]));
        this.hostapd = this.watch("hostapd", command.spawn("hostapd", [files.hostapd]));

        return this.running;
    }

    stop() {
        const wasRunning = this.running;

        Hotspot.kill(this.dnsmasq);
        Hotspot.kill(this.hostapd);

        if (wasRunning && validate.iface(this.iface)) command.exec("ip", ["addr", "flush", "dev", this.iface]);

        if (this.folder) rmSync(this.folder, { recursive: true, force: true });

        this.hostapd = null;
        this.dnsmasq = null;
        this.folder = null;
    }

    // Sends what a child process prints to the log, one line at a time.
    watch(name, child) {
        if (!child) return null;

        const print = (data) => {
            for (const line of data.toString().split("\n").map((value) => value.trim()).filter((value) => value !== "")) {
                this.log(`${name}: ${line}`);
            }
        };

        child.stdout.on("data", print);
        child.stderr.on("data", print);

        return child;
    }

    static alive(child) {
        return Boolean(child) && child.pid !== undefined && child.exitCode === null && child.signalCode === null && !child.killed;
    }

    static kill(child) {
        if (Hotspot.alive(child)) child.kill();
    }

    static uuid(seed) {
        const chars = "023456789ABCDEFGHIJKLMNPQRSTUVWXYZ";

        let result = "";

        for (let i = seed || 6; i > 0; i -= 1) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }

        return result;
    }
}

module.exports = Hotspot;
