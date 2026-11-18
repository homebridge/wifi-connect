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

// Reads the output of "nmcli --terse". Each line is one record, and the fields are split by ":".
// A ":" or a "\" inside a value is written as "\:" or "\\".

class Terse {
    // One line -> list of field values.
    static fields(line) {
        const fields = [];

        let value = "";

        for (let i = 0; i < line.length; i += 1) {
            if (line[i] === "\\" && i + 1 < line.length) {
                value += line[i + 1];
                i += 1;
            } else if (line[i] === ":") {
                fields.push(value);
                value = "";
            } else {
                value += line[i];
            }
        }

        fields.push(value);

        return fields;
    }

    // Whole output -> list of records. Records with fewer fields than expected are dropped.
    static records(output, count) {
        return (output || "").split("\n")
            .filter((line) => line !== "")
            .map((line) => Terse.fields(line))
            .filter((fields) => fields.length >= count);
    }
}

module.exports = Terse;
