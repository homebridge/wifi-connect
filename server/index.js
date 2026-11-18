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

const http = require("http");
const express = require("express");
const network = require("../network");
const compression = require("compression");
const { join } = require("path");

class Server {
    constructor(log) {
        this.log = log;
        this.running = false;

        this.iface = "wlan0";

        // Ends the program once the device has joined a WiFi network.
        this.exit = () => process.exit();

        // Called for every request, so the caller can tell that the setup page is in use.
        this.activity = () => {};

        // Called when the web server can not start.
        this.failed = (error) => { throw error; };

        const app = express();

        app.use(compression());
        app.use(express.json());
        app.disable("x-powered-by");

        this.server = http.createServer(app);

        this.server.on("error", (error) => this.failed(error));

        app.use((request, _response, next) => {
            this.log.debug(`request [${request.method}] ${request.url}`);
            this.activity();

            next();
        });

        app.use("/", express.static(join(__dirname, "../interface"), {
            setHeaders: (response) => { response.setHeader("cache-control", "public, max-age=1209600000"); },
        }));

        require("./network")(app);
        require("./ethernet")(app);
        require("./wireless")(app, this);
        require("./hotspot")(app);

        app.use((_request, response) => response.redirect("/"));
    }

    // Starts the web server, then the hotspot on the given WiFi device.
    start(port, iface) {
        this.iface = iface || "wlan0";

        network.wireless.enabled = true;

        this.log.info("starting portal");

        const number = parseInt(port, 10);

        this.server.listen(Number.isInteger(number) && number >= 0 ? number : 80, () => {
            this.running = true;

            this.hotspot();

            this.log.info(`listening on port ${this.server.address().port}`);
        });
    }

    // Starts the hotspot again from a clean state.
    hotspot() {
        network.hotspot.stop();
        network.wireless.disconnect(this.iface);
        network.hotspot.start("Homebridge WiFi Setup", this.iface);
    }

    // Stops the hotspot and the web server. Open connections are closed at once.
    stop() {
        if (!this.running) return Promise.resolve();

        this.running = false;

        this.log.info("shutting down portal");

        network.hotspot.stop();

        return new Promise((resolve) => {
            this.server.close(() => {
                this.log.info("stopped");

                resolve();
            });

            this.server.closeAllConnections();
        });
    }
}

module.exports = (log) => new Server(log);
