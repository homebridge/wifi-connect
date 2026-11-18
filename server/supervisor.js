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

// Decides when the setup hotspot runs.
//
//   1. Wait a short time for a network connection (cable or WiFi). If there is one, end.
//   2. If a WiFi network is already saved, end. NetworkManager keeps trying a saved network
//      by itself, for example when the router starts later than this device after a power cut.
//   3. Only when no WiFi network is saved: start the hotspot and the setup page.
//   4. If nobody uses the setup page for a while, stop the hotspot and go back to step 1.
//
// Ending means the program exits with code 0, so the system carries on starting.

const DEFAULTS = {
    // seconds to wait for a network connection before deciding
    waitSeconds: 20,

    // seconds the setup page may sit unused before the hotspot is stopped for a new check
    idleSeconds: 5 * 60,
};

class Supervisor {
    constructor(options) {
        this.network = options.network;
        this.server = options.server;
        this.log = options.log;
        this.port = options.port;
        this.waitSeconds = options.waitSeconds === undefined ? DEFAULTS.waitSeconds : options.waitSeconds;
        this.idleSeconds = options.idleSeconds === undefined ? DEFAULTS.idleSeconds : options.idleSeconds;
        this.exit = options.exit || ((code) => process.exit(code));

        this.state = "new";
        this.timer = null;

        // the setup page was used: start the idle time again
        this.server.activity = () => this.touch();

        // the device joined a WiFi network from the setup page
        this.server.exit = () => this.finish("connected to a WiFi network");

        // the web server could not start, for example because the port is in use
        this.server.failed = (error) => {
            this.log.error(`the setup page could not start: ${error.message}`);
            this.end(1);
        };
    }

    start() {
        this.log.info("waiting for a network connection");
        this.wait(0);
    }

    wait(attempt) {
        this.state = "waiting";

        if (this.network.connected) {
            this.finish("a network is connected");
        } else if (attempt >= this.waitSeconds) {
            this.decide();
        } else {
            this.timer = setTimeout(() => this.wait(attempt + 1), 1000);
        }
    }

    decide() {
        const wifi = this.network.devices().find((device) => device.type === "wifi");
        const saved = this.network.wireless.saved();

        if (!wifi) {
            this.finish("this device has no WiFi");
        } else if (saved.length > 0) {
            this.finish(`a WiFi network is already saved (${saved.map((connection) => connection.name).join(", ")}), so the setup hotspot is not needed`);
        } else {
            this.state = "portal";
            this.log.info("no network and no saved WiFi network: starting the setup hotspot");
            this.server.start(this.port, wifi.iface);
            this.touch();
        }
    }

    touch() {
        if (this.state !== "portal") return;

        clearTimeout(this.timer);

        this.timer = setTimeout(() => this.idle(), this.idleSeconds * 1000);
    }

    idle() {
        this.state = "stopping";
        this.log.info(`the setup page was not used for ${Math.round(this.idleSeconds / 60)} minutes: stopping the hotspot to check the network again`);

        this.server.stop().then(() => {
            if (this.state === "stopping") this.start();
        });
    }

    finish(reason) {
        this.log.info(`${reason}: nothing more to do`);
        this.end(0);
    }

    end(code) {
        clearTimeout(this.timer);

        this.state = "done";
        this.exit(code);
    }

    // Used when the program is told to stop from outside.
    stop() {
        clearTimeout(this.timer);

        this.state = "done";

        return this.server.stop();
    }
}

module.exports = (options) => new Supervisor(options);
module.exports.DEFAULTS = DEFAULTS;
