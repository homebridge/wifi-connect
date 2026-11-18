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

const { execFileSync, spawn } = require("node:child_process");
const { accessSync, constants, statSync } = require("node:fs");
const { join } = require("node:path");

// The only programs this package runs.
const PROGRAMS = ["nmcli", "ip", "hostapd", "dnsmasq"];

// Where the programs are looked for. These are the system folders only, so a folder that
// another user can write to is never searched. Tests point this at a folder of fake programs.
const SYSTEM_PATH = ["/usr/sbin", "/usr/bin", "/sbin", "/bin"];

class Command {
    static searchPath = [...SYSTEM_PATH];

    // Called with (program, exit status or error code) when a program fails. The arguments are
    // left out on purpose: they can hold a WiFi password.
    static onError = null;

    // The programs get a small fixed environment. The C locale keeps their output in English,
    // which the parsers in this package depend on.
    static get environment() {
        return {
            PATH: Command.searchPath.join(":"),
            LANG: "C.UTF-8",
            LC_ALL: "C.UTF-8",
        };
    }

    // The full path of a program, or undefined if it is not installed.
    static path(program) {
        if (!PROGRAMS.includes(program)) return undefined;

        for (const folder of Command.searchPath) {
            const candidate = join(folder, program);

            try {
                accessSync(candidate, constants.X_OK);

                if (statSync(candidate).isFile()) return candidate;
            } catch (_error) {
                // not in this folder
            }
        }

        return undefined;
    }

    // Runs a program and returns what it printed, or undefined if it failed.
    // The arguments are handed over as a list, one value per item. No shell is involved.
    static exec(program, args, options) {
        const executable = Command.path(program);

        if (!executable) {
            Command.failed(program, "ENOENT");

            return undefined;
        }

        const list = Command.list(args);

        try {
            return execFileSync(executable, list, {
                env: Command.environment,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
                timeout: (options || {}).timeout || 30 * 1000,
                maxBuffer: 4 * 1024 * 1024,
            }).trim();
        } catch (error) {
            Command.failed(program, error.status === null || error.status === undefined ? error.code : error.status);

            return undefined;
        }
    }

    // Starts a long running program and returns the child process, or undefined.
    static spawn(program, args) {
        const executable = Command.path(program);

        if (!executable) {
            Command.failed(program, "ENOENT");

            return undefined;
        }

        const child = spawn(executable, Command.list(args), {
            env: Command.environment,
            stdio: ["ignore", "pipe", "pipe"],
        });

        child.on("error", (error) => Command.failed(program, error.code));

        return child;
    }

    static list(args) {
        if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
            throw new TypeError("arguments must be a list of strings");
        }

        return args;
    }

    static failed(program, reason) {
        if (typeof Command.onError === "function") Command.onError(program, reason);
    }
}

module.exports = Command;
