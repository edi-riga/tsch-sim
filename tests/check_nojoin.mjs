/*
 * This file checks that the nodes have not joined the network.
 */

import fs from 'fs';
import process from 'process';

const RUN_ID = "0";
const ROOT_ID = "1";

if (process.argv.length < 3) {
    console.log("results file not supplied");
    process.exit(1);
}

const filedata = fs.readFileSync(process.argv[process.argv.length - 1]);
const state = JSON.parse(filedata);
const run_state = state[RUN_ID];
let is_any_valid = false;

for (let key in run_state) {
    if (key === "global-stats" || key === ROOT_ID) continue;

    const join_time = run_state[key].stats_tsch_join_time_sec;
    if (join_time !== null) {
        console.log("Node " + key + " joined");
        console.log("  state:\n" + JSON.stringify(run_state[key]));
        process.exit(1);
    }
    is_any_valid = true;
}

if (!is_any_valid) {
    console.log("No valid nodes in the results");
    process.exit(1);
}

/* success */
process.exit(0);
