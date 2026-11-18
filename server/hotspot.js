/**************************************************************************************************
 * hoobs-portal                                                                                   *
 * Copyright (C) 2021 HOOBS                                                                       *
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

const network = require("../network");
const invalid = require("./invalid");

class Hotspot {
    constructor(app) {
        app.post("/api/hotspot/start", (request, response) => this.start(request, response));
        app.post("/api/hotspot/stop", (_request, response) => this.stop(response));
    }

    start(request, response) {
        const iface = (request.body || {}).iface || "wlan0";
        const ssid = (request.body || {}).ssid || "Homebridge WiFi Setup";

        if (!network.wireless.known(iface) || !network.validate.ssid(ssid)) return invalid(response);

        if (!network.hotspot.running && network.wireless.enabled) {
            network.wireless.disconnect(iface);
            network.hotspot.start(ssid, iface);
        }

        return response.send();
    }

    stop(response) {
        network.hotspot.stop();
        response.send();
    }
}

module.exports = (app) => new Hotspot(app);
