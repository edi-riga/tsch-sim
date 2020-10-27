/*
 * This file checks that the TSCH "stats" printed in the log file is correct.
 */

import fs from 'fs';
import process from 'process';

if (process.argv.length < 3) {
    console.log("log file not supplied");
    process.exit(1);
}

const filedata = fs.readFileSync(process.argv[process.argv.length - 1], "utf8");
const lines = filedata.split("\n");
let is_all_valid = true;
let is_any_valid = false;

for (let line of lines) {
    if (line.indexOf("TSCH\tstats:") !== -1) {
        const fields = line.substr(10).replace("\t", " ").split(" ");
        if (fields.length > 4) {
            const stats = fields.slice(5, fields.length);
            let stats_obj;
            try {
                stats_obj = JSON.parse(stats);
            } catch (x) {
                console.log("Failed to parse, line=\"" + line + "\"");
                is_all_valid = false;
                continue;
            }
            let ok = true;
            for (let key in stats_obj) {
                const value = stats_obj[key];
                if (isNaN(parseInt(value))) {
                    console.log("Failed to parse as integer, value=" + value);
                    is_all_valid = false;
                    ok = false;
                }
            }
            if (ok) {
                is_any_valid = true;
            }
        }
    }
}

if (!is_any_valid) {
    console.log("No any TSCH stats in the log file");
    process.exit(1);
}

if (!is_all_valid) {
    console.log("Not all TSCH stats are valid in the log file");
    process.exit(1);
}

/* success */
process.exit(0);
