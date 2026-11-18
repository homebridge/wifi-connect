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

        // Ends the program once the device has joined a WiFi network. Tests replace this.
        this.exit = () => process.exit();

        const app = express();

        app.use(compression());
        app.use(express.json());
        app.disable("x-powered-by");

        this.server = http.createServer(app);

        app.use((request, _response, next) => {
            this.log.debug(`request [${request.method}] ${request.url}`);

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

    start(port) {
        network.wireless.enabled = true;

        this.log.info("starting portal");

        this.server.listen(parseInt(port, 10) || 80, () => {
            this.running = true;

            network.wireless.disconnect("wlan0");
            network.hotspot.start("Homebridge WiFi Setup", "wlan0");

            this.log.info(`listening on port ${parseInt(port, 10) || 80}`);
        });
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
