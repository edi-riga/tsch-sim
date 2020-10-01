/*
 * This file checks that the end-to-end PDR in a test reaches a specified minimum on all non-root nodes.
 */

import fs from 'fs';
import process from 'process';

const RUN_ID = "0";
const ROOT_ID = "1";
let only_id = null;

let min_pdr = 100.0;

if (process.argv.length < 3) {
    console.log("results file not supplied");
    process.exit(1);
}

if (process.argv.length > 4) {
    only_id = parseInt(process.argv[process.argv.length - 1]).toString();
    process.argv.length -= 1;
}

if (process.argv.length > 3) {
    min_pdr = parseFloat(process.argv[process.argv.length - 1]);
    process.argv.length -= 1;
}

const filedata = fs.readFileSync(process.argv[process.argv.length - 1]);
const state = JSON.parse(filedata);
const run_state = state[RUN_ID];
let is_any_valid = false;

for (let key in run_state) {
    if (key === "global-stats") continue;

    if (only_id && key !== only_id) continue;
    if (only_id !== ROOT_ID && key === ROOT_ID) continue;

    const tx = run_state[key].app_num_tx;
    const lost = run_state[key].app_num_lost;
    const pdr = run_state[key].app_reliability;

    if (!tx) {
        console.log("No app data packets transmitted from node " + key);
        console.log("  state:\n" + JSON.stringify(run_state[key]));
        process.exit(1);
    }

    if (pdr < min_pdr) {
        console.log("Too many app data packets lost from node " + key + " pdr=" + pdr.toFixed(3) + " lost=" + lost);
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
