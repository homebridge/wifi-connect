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

const command = require("./command");
const terse = require("./terse");
const validate = require("./validate");

const FIELDS = "active,ssid,bssid,mode,chan,freq,signal,security,wpa-flags,rsn-flags";

// How long nmcli waits for a connection to come up, in seconds.
const CONNECT_WAIT = 30;

function security(fields, offset) {
    const mode = fields[offset];

    return {
        mode: !mode || mode === "--" || mode === "(none)" ? "none" : mode,
        wpa: fields[offset + 1],
        rsn: fields[offset + 2],
    };
}

function channel(fields) {
    return {
        bssid: fields[2],
        mode: fields[3],
        channel: parseInt(fields[4], 10),
        frequency: parseInt(fields[5], 10),
        signal: parseFloat(fields[6]) / 2 - 100,
        quality: parseInt(fields[6], 10) || 0,
    };
}

// Several access points can share one network name. They are grouped into one entry,
// which keeps the best signal quality.
function group(networks) {
    const results = new Map();

    for (const network of networks) {
        const key = JSON.stringify(network.entry);

        if (!results.has(key)) {
            results.set(key, { ...network.entry, quality: network.channel.quality, security: network.security, channels: [] });
        }

        const entry = results.get(key);

        if (network.channel.quality > entry.quality) entry.quality = network.channel.quality;

        entry.channels.push(network.channel);
    }

    return [...results.values()];
}

class Wireless {
    static get enabled() {
        return command.exec("nmcli", ["radio", "wifi"]) === "enabled";
    }

    static set enabled(value) {
        command.exec("nmcli", ["radio", "wifi", value ? "on" : "off"]);
    }

    // The WiFi devices NetworkManager looks after.
    static devices() {
        const args = ["--terse", "--fields", "device,type,state", "device"];

        return terse.records(command.exec("nmcli", args), 3)
            .filter((fields) => fields[1] === "wifi" && fields[2] !== "unmanaged")
            .map((fields) => fields[0]);
    }

    // True when the name passes the name check and is one of the WiFi devices.
    static known(iface) {
        return validate.iface(iface) && Wireless.devices().includes(iface);
    }

    // The WiFi networks in range. Names that fail the name check are left out.
    static scan(iface) {
        const args = ["--terse", "--fields", FIELDS, "device", "wifi", "list", "--rescan", "yes"];

        if (iface !== undefined && iface !== null && iface !== "") {
            if (!validate.iface(iface)) return [];

            args.push("ifname", iface);
        }

        const networks = terse.records(command.exec("nmcli", args), 10)
            .filter((fields) => validate.ssid(fields[1]))
            .map((fields) => ({
                entry: { ssid: fields[1] },
                security: security(fields, 7),
                channel: channel(fields),
            }));

        return group(networks);
    }

    // The WiFi networks this device is connected to right now.
    static current() {
        const args = ["--terse", "--fields", `${FIELDS},device`, "device", "wifi"];

        const networks = terse.records(command.exec("nmcli", args), 11)
            .filter((fields) => fields[0] === "yes" && fields[1] !== "")
            .map((fields) => ({
                entry: { iface: fields[10], ssid: fields[1] },
                security: security(fields, 7),
                channel: channel(fields),
            }));

        return group(networks);
    }

    // The WiFi networks NetworkManager has saved, connected or not.
    static saved() {
        const args = ["--terse", "--fields", "name,uuid,type", "connection", "show"];

        return terse.records(command.exec("nmcli", args), 3)
            .filter((fields) => fields[2] === "802-11-wireless" && validate.uuid(fields[1]))
            .map((fields) => ({ name: fields[0], uuid: fields[1] }));
    }

    // Returns true if nmcli reports the connection as up.
    static connect(ssid, password, iface) {
        if (!validate.ssid(ssid) || !validate.password(password) || !validate.iface(iface)) return false;

        command.exec("ip", ["addr", "flush", "dev", iface]);

        const args = ["--wait", `${CONNECT_WAIT}`, "device", "wifi", "connect", ssid];

        if (password !== undefined && password !== null && password !== "") args.push("password", password);

        args.push("ifname", iface);

        return command.exec("nmcli", args, { timeout: (CONNECT_WAIT + 15) * 1000 }) !== undefined;
    }

    static disconnect(iface) {
        if (!validate.iface(iface)) return false;

        command.exec("ip", ["addr", "flush", "dev", iface]);

        return command.exec("nmcli", ["device", "disconnect", iface]) !== undefined;
    }

    // Makes NetworkManager set the device up again with its current connection.
    static reapply(iface) {
        if (!validate.iface(iface)) return false;

        return command.exec("nmcli", ["device", "reapply", iface]) !== undefined;
    }

    // Removes the saved WiFi networks with this name. Other kinds of connection are never touched.
    // Returns how many were removed.
    static forget(ssid) {
        if (!validate.ssid(ssid)) return 0;

        let removed = 0;

        for (const connection of Wireless.saved()) {
            const stored = command.exec("nmcli", ["--terse", "--get-values", "802-11-wireless.ssid", "connection", "show", "uuid", connection.uuid]);

            if (connection.name === ssid || terse.fields(stored || "")[0] === ssid) {
                if (command.exec("nmcli", ["connection", "delete", "uuid", connection.uuid]) !== undefined) removed += 1;
            }
        }

        return removed;
    }
}

module.exports = Wireless;
