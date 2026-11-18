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

class Ethernet {
    // The cable connections that are up right now.
    static current() {
        const args = ["--terse", "--fields", "active,device,type", "connection", "show"];

        return terse.records(command.exec("nmcli", args), 3)
            .filter((fields) => fields[0] === "yes" && fields[2].toLowerCase().includes("ethernet") && fields[1] !== "")
            .map((fields) => ({ iface: fields[1] }));
    }

    // The cable network devices NetworkManager looks after.
    static devices() {
        const args = ["--terse", "--fields", "device,type,state", "device"];

        return terse.records(command.exec("nmcli", args), 3)
            .filter((fields) => fields[1] === "ethernet" && fields[2] !== "unmanaged")
            .map((fields) => fields[0]);
    }

    static known(iface) {
        return validate.iface(iface) && Ethernet.devices().includes(iface);
    }

    static up(iface) {
        if (!Ethernet.known(iface)) return false;

        return command.exec("nmcli", ["device", "connect", iface]) !== undefined;
    }

    static down(iface) {
        if (!Ethernet.known(iface)) return false;

        return command.exec("nmcli", ["device", "disconnect", iface]) !== undefined;
    }
}

module.exports = Ethernet;
