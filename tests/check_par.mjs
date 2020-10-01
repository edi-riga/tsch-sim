/*
 * This file checks that the PDR in a test is 100% from all non-root nodes.
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
let last_par = 1.0;
let had_no_packets = false;

for (let key in run_state) {
    if (key === "global-stats" || key === ROOT_ID) continue;
     
    const tx = run_state[key].mac_parent_tx_unicast;
    const acked = run_state[key].mac_parent_acked;

    if (!tx) {
        had_no_packets = true;
    } else if (had_no_packets) {
        console.log("Some nodes unexpectedly transmitted no app packets, while nodes with worse links had packets");
        process.exit(1);
    }

    let par = acked / tx;
    if (par > last_par) {
        console.log(`More packets acked, but link quality is worse: ${par} vs ${last_par}`);
        console.log("  state:\n" + JSON.stringify(run_state[key]));
        process.exit(1);
    }
    /* console.log(`Fewer or some packets acked and link quality is worse: ${par} vs ${last_par}`); */
    last_par = par;
}

if (had_no_packets === false) {
    console.log("The last entry had some packets, expected none");
    process.exit(1);
}

const pdr = run_state["global-stats"]["e2e-delivery"].value;
if (pdr <= 0) {
    console.log("Zero PDR for all nodes");
    process.exit(1);
}

/* success */
process.exit(0);
