/* This function checks the connectivity of the leaf node and disabled  */
function check_connectivity(state) {
    if (this.is_stat_collection_mode) return;

    let all_ok = true;

    for (const [id, node] of state.network.nodes) {
        if (id === 1) continue;

        if (!node.orchestra_parent_knows_us) {
            all_ok = false;
            break;
        }
    }

    if (all_ok) {
        /* reset stats and enter the collection mode */
        state.log.log(state.log.INFO, null, "User", "reset stats and enter the collection mode");
        for (const [id, node] of state.network.nodes) {
            node.reset_stats();
        }
        this.is_stat_collection_mode = true;
    }
}

let callbacks = {};
/* Check the connectivity periodically, once 500 ASN */
for (let i = 1000; i < state.config.SIMULATION_DURATION_SEC * 100; i += 500) {
    callbacks[i] = check_connectivity;
}

/* Set the callbacks to be executed during the simulation */
return callbacks;
