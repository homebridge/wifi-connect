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

class Wireless {
    constructor(app, server) {
        this.server = server;

        app.get("/api/networks", (_request, response) => this.networks(response));
        app.post("/api/wireless/enable", (_request, response) => this.state(true, response));
        app.post("/api/wireless/disable", (_request, response) => this.state(false, response));
        app.post("/api/:iface/connect", (request, response) => this.connect(request, response));
        app.post("/api/:iface/disconnect", (request, response) => this.disconnect(request, response));
    }

    networks(response) {
        if (network.wireless.enabled) {
            response.send(network.wireless.scan());
        } else {
            response.send();
        }
    }

    state(enabled, response) {
        network.wireless.enabled = enabled;

        response.send();
    }

    connect(request, response) {
        const { iface } = request.params;
        const { ssid, password } = request.body || {};

        if (!network.wireless.known(iface) || !network.validate.ssid(ssid) || !network.validate.password(password)) return invalid(response);

        if (network.wireless.enabled) {
            // the setup page is up when the web server was started together with the hotspot
            const portal = this.server.running || network.hotspot.running;

            network.wireless.connect(ssid, password, iface);

            if (network.wireless.current().find((connection) => connection.ssid === ssid)) {
                if (portal) {
                    network.hotspot.stop();
                    network.wireless.reapply(iface);
                }

                // the WiFi this request came in on is gone by now, so the program ends without waiting
                this.server.exit();

                return response.send();
            }

            // The connection did not come up, for example because the password is wrong.
            // The failed network must not stay saved: the hotspot only starts when none is saved.
            network.wireless.forget(ssid);

            if (portal) this.server.hotspot();
        }

        return response.send();
    }

    disconnect(request, response) {
        const { iface } = request.params;
        const { ssid } = request.body || {};

        if (!network.wireless.known(iface) || !network.validate.ssid(ssid)) return invalid(response);

        if (network.wireless.enabled) {
            network.wireless.disconnect(iface);
            network.wireless.forget(ssid);
        }

        return response.send();
    }
}

module.exports = (app, server) => new Wireless(app, server);
