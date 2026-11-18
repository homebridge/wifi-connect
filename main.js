#!/usr/bin/env node

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

const { parseArgs } = require("node:util");
const network = require("./network");
const pjson = require("./package.json");
const log = require("./server/logger")();
const server = require("./server")(log);
const supervisor = require("./server/supervisor");

const USAGE = `Usage: wifi-connect [options] [start]

Options:
  -v, --version      output the current version
  -d, --debug        turn on debug level logging
  -p, --port <port>  change the port the portal runs on
  -h, --help         display this help`;

let running;

function daemon() {
    let parsed;

    try {
        parsed = parseArgs({
            allowPositionals: true,
            options: {
                version: { type: "boolean", short: "v" },
                debug: { type: "boolean", short: "d" },
                port: { type: "string", short: "p" },
                help: { type: "boolean", short: "h" },
            },
        });
    } catch (error) {
        console.error(`${error.message}\n\n${USAGE}`);
        process.exit(1);
    }

    const [command, ...extra] = parsed.positionals;

    if (parsed.values.version) {
        console.log(pjson.version);
    } else if (parsed.values.help) {
        console.log(USAGE);
    } else if ((command !== undefined && command !== "start") || extra.length > 0) {
        console.error(`unknown command\n\n${USAGE}`);
        process.exit(1);
    } else {
        if (parsed.values.debug) log.debugging = true;

        network.command.onError = (program, reason) => log.debug(`${program} failed (${reason})`);
        network.hotspot.log = (line) => log.info(line);

        running = supervisor({ network, server, log, port: parsed.values.port });
        running.start();
    }
}

// Asked to stop from outside (for example "systemctl stop"): shut down cleanly, then end.
function shutdown() {
    (running ? running.stop() : Promise.resolve()).finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Whatever the reason for ending, never leave the hotspot behind.
process.on("exit", () => network.hotspot.stop());

daemon();
