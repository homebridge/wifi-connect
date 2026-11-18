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

// Linux interface names are at most 15 characters. Only the characters that real network
// devices use are accepted, and the first one must be a letter or a digit.
const IFACE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,14}$/;

// Control characters (new line, tab, escape ...) are never part of a name a person can pick.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function bytes(value) {
    return Buffer.byteLength(value, "utf8");
}

class Validate {
    // A network interface name, for example "wlan0" or "eth0".
    static iface(value) {
        return typeof value === "string" && IFACE.test(value);
    }

    // A WiFi network name. The WiFi standard allows 1 to 32 bytes.
    static ssid(value) {
        return typeof value === "string" && bytes(value) >= 1 && bytes(value) <= 32 && !CONTROL.test(value);
    }

    // A WiFi password. Open networks have none. The longest allowed form is 64 characters.
    static password(value) {
        if (value === undefined || value === null || value === "") return true;

        return typeof value === "string" && bytes(value) <= 64 && !CONTROL.test(value);
    }

    // The id NetworkManager gives a saved connection.
    static uuid(value) {
        return typeof value === "string" && UUID.test(value);
    }

    static ipv4(value) {
        return typeof value === "string" && IPV4.test(value);
    }
}

module.exports = Validate;
