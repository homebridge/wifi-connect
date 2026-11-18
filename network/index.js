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
const ethernet = require("./ethernet");
const hotspot = require("./hotspot");
const terse = require("./terse");
const validate = require("./validate");
const wireless = require("./wireless");

let AP;

class Network {
    static get command() {
        return command;
    }

    static get validate() {
        return validate;
    }

    static get ethernet() {
        return ethernet;
    }

    static get wireless() {
        return wireless;
    }

    static get hotspot() {
        if (!AP) AP = new hotspot();

        return AP;
    }

    // True when a cable or a WiFi network is connected.
    static get connected() {
        return Network.current().length > 0;
    }

    static current() {
        return [...ethernet.current(), ...wireless.current()];
    }

    // The network devices NetworkManager looks after.
    static devices() {
        const args = ["--terse", "--fields", "device,type,state", "device"];

        return terse.records(command.exec("nmcli", args), 3)
            .filter((fields) => fields[2] !== "unmanaged")
            .map((fields) => ({
                iface: fields[0],
                type: fields[1],
                active: fields[2] === "connected",
            }));
    }
}

module.exports = Network;
