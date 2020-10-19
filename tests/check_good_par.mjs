/*
 * This file checks that the PAR in a test is >99%.
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

for (let key in run_state) {
    if (key === "global-stats" || key === ROOT_ID) continue;
     
    const tx = run_state[key].mac_parent_tx_unicast;
    const acked = run_state[key].mac_parent_acked;

    if (!tx) {
        console.log("Some nodes unexpectedly transmitted no app packets, while nodes with worse links had packets");
        process.exit(1);
    }

    let par = 100.0 * acked / tx;
    if (par < 99) {
        console.log(`Too few packets acked PAR=${par}`);
        console.log("  state:\n" + JSON.stringify(run_state[key]));
        process.exit(1);
    }
}

const pdr = run_state["global-stats"]["e2e-delivery"].value;
if (pdr <= 0) {
    console.log("Zero PDR for all nodes");
    process.exit(1);
}

/* success */
process.exit(0);
