/*
 * This file checks that a result statistic is equal to a value passed a an argument
 */

import fs from 'fs';
import process from 'process';

const RUN_ID = "0";
const ROOT_ID = "1";

if (process.argv.length < 6) {
    console.log("results file, node ID, stat name and value not supplied");
    process.exit(1);
}

const filedata = fs.readFileSync(process.argv[2]);
const node_id = parseInt(process.argv[3]).toString();
const stat_name = process.argv[4];
const op = process.argv[5];
const required_stat_value = parseFloat(process.argv[6]);

const state = JSON.parse(filedata);
const run_state = state[RUN_ID];
let is_any_valid = false;

for (let key in run_state) {
    if (node_id == -1) {
        if (key === "global-stats" || key === ROOT_ID) continue;
    } else {
        if (key !== node_id) continue;
    }

    const stat_value = run_state[key][stat_name];
    if (op == "=") {
        if (!(stat_value == required_stat_value)) {
            console.log(`For "${stat_name}" value ${stat_value} is not equal to required value ${required_stat_value}`);
            process.exit(1);
        }
    } else if (op == ">") {
        if (!(stat_value > required_stat_value)) {
            console.log(`For "${stat_name}" value ${stat_value} is not greater than required value ${required_stat_value}`);
            process.exit(1);
        }
    } else if (op == "<") {
        if (!(stat_value < required_stat_value)) {
            console.log(`For "${stat_name}" value ${stat_value} is not lesser than required value ${required_stat_value}`);
            process.exit(1);
        }
    } else {
        console.log(`Unknown op ${op} for ${stat_name}`);
        process.exit(1);
    }

    is_any_valid = true;
}

if (!is_any_valid) {
    console.log("No stats found for node " + node_id);
    process.exit(1);
}

/* success */
process.exit(0);
